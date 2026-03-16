#!/usr/bin/env python3
"""
OCR para guías de envío colombianas (Interrapidísimo, Coordinadora, etc.)
Uso: python3 extract_guide.py <ruta_imagen>
Salida: JSON con tracking_number y shipping_cost
"""

import sys
import json
import re
import os

try:
    import pytesseract
    from PIL import Image
except ImportError as e:
    print(json.dumps({"ok": False, "error": f"Dependencia faltante: {e}"}))
    sys.exit(1)

# En Windows, Tesseract se instala en una ruta fija
if sys.platform == "win32":
    import os as _os
    _win_path = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    if _os.path.exists(_win_path):
        pytesseract.pytesseract.tesseract_cmd = _win_path


def limpiar_numero(texto):
    """Elimina puntos y comas de formato colombiano: '12.200' -> '12200'"""
    return re.sub(r'[^\d]', '', texto)


def extraer_datos(texto):
    """Extrae número de guía y valor a cobrar del texto OCR."""
    tracking = None
    valor = None

    # ── Número de guía ──────────────────────────────────────────────────────
    patrones_guia = [
        r'GU[IÍ]A\s*[:\-.]?\s*(\d{8,16})',           # GUIA : 7001869938163
        r'No\.?\s*(?:de\s*)?[Gg]u[ií]a\s*[:\-.]?\s*(\d{8,16})',  # No. de Guia: 123
        r'GUIA\s+No\.?\s*(\d{8,16})',                 # GUIA No. 123
        r'\bGU[IÍ]A\b.*?(\d{10,16})',                 # GUIA (cualquier cosa) 1234567890
    ]
    for patron in patrones_guia:
        m = re.search(patron, texto, re.IGNORECASE)
        if m:
            tracking = m.group(1).strip()
            break

    # ── Valor a cobrar ───────────────────────────────────────────────────────
    patrones_valor = [
        r'[Vv]alor\s+[Aa]\s+[Cc]obrar\s*[:\-.]?\s*\$?\s*([\d.,]+)',  # Valor a Cobrar : $ 12.200
        r'[Vv]alor\s+[Cc]obrar\s*[:\-.]?\s*\$?\s*([\d.,]+)',          # Valor Cobrar : 12.200
        r'COD\s*[:\-.]?\s*\$?\s*([\d.,]+)',                            # COD: 12.200
        r'\$\s*([\d]+[.,][\d]{3})',                                    # $ 12.200 (formato colombiano)
        r'[Vv]alor\s*[:\-.]?\s*\$?\s*([\d.,]+)',                      # Valor: 12.200
    ]
    for patron in patrones_valor:
        m = re.search(patron, texto, re.IGNORECASE)
        if m:
            raw = m.group(1).strip()
            valor = limpiar_numero(raw)
            if valor and int(valor) > 0:
                break
            else:
                valor = None

    return tracking, valor


def ocr_imagen(imagen):
    """Ejecuta Tesseract sobre una imagen PIL."""
    config = '--psm 6 -l spa+eng'
    return pytesseract.image_to_string(imagen, config=config)


def detectar_rotacion(imagen):
    """Intenta detectar el ángulo de rotación con OSD de Tesseract."""
    try:
        osd = pytesseract.image_to_osd(imagen, config='--psm 0')
        m = re.search(r'Rotate:\s*(\d+)', osd)
        if m:
            return int(m.group(1))
    except Exception:
        pass
    return 0


def procesar_imagen(ruta):
    imagen_original = Image.open(ruta)

    # Convertir a RGB si es necesario (ej. PNG con transparencia)
    if imagen_original.mode not in ('RGB', 'L'):
        imagen_original = imagen_original.convert('RGB')

    best_tracking = None
    best_valor = None

    # 1) Intentar detectar rotación automáticamente
    angulo_osd = detectar_rotacion(imagen_original)
    if angulo_osd != 0:
        candidata = imagen_original.rotate(-angulo_osd, expand=True)
        texto = ocr_imagen(candidata)
        best_tracking, best_valor = extraer_datos(texto)
        if best_tracking and best_valor:
            return best_tracking, best_valor

    # 2) Intentar con la imagen original (sin rotar)
    texto = ocr_imagen(imagen_original)
    t, v = extraer_datos(texto)
    if t and not best_tracking:
        best_tracking = t
    if v and not best_valor:
        best_valor = v

    if best_tracking and best_valor:
        return best_tracking, best_valor

    # 3) Probar todas las rotaciones (90, 180, 270)
    for angulo in [90, 180, 270]:
        rotada = imagen_original.rotate(angulo, expand=True)
        texto = ocr_imagen(rotada)
        t, v = extraer_datos(texto)
        if t and not best_tracking:
            best_tracking = t
        if v and not best_valor:
            best_valor = v
        if best_tracking and best_valor:
            break

    return best_tracking, best_valor


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Falta ruta de imagen"}))
        sys.exit(1)

    ruta = sys.argv[1]
    if not os.path.exists(ruta):
        print(json.dumps({"ok": False, "error": "Archivo no encontrado"}))
        sys.exit(1)

    try:
        tracking, valor = procesar_imagen(ruta)
        print(json.dumps({
            "ok": True,
            "tracking_number": tracking,
            "shipping_cost": valor,
        }))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
