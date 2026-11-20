#!/usr/bin/env python3
"""
OCR para guías de envío colombianas (Interrapidísimo, Coordinadora, etc.)
Uso: python3 extract_guide.py <ruta_imagen>
     python3 extract_guide.py --price <ruta_imagen> [giros]   (modo rápido: la foto ya viene derecha y reducida)
Salida: JSON con tracking_number y shipping_cost
"""

import sys
import json
import re
import os

try:
    import pytesseract
    from PIL import Image, ImageOps
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


VALOR_MIN, VALOR_MAX = 500, 5_000_000


def extraer_valor(texto):
    """Valor a cobrar: primero el número junto a 'Cobrar', luego cualquier '$ 12.345'."""
    patrones = [
        r'C[o0]brar[\s\S]{0,30}?\$?\s*(\d{1,3}(?:[.,]\d{3})+)',
        r'\$\s*(\d{1,3}(?:[.,]\d{3})+)',
    ]
    for patron in patrones:
        for m in re.finditer(patron, texto, re.IGNORECASE):
            valor = limpiar_numero(m.group(1))
            if valor and VALOR_MIN <= int(valor) <= VALOR_MAX:
                return valor
    return None


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


def preparar(imagen_gris, angulo):
    """Gira, mejora el contraste y amplía las fotos pequeñas para que Tesseract lea mejor."""
    r = imagen_gris.rotate(angulo, expand=True, fillcolor=255) if angulo else imagen_gris
    r = ImageOps.autocontrast(r)
    if r.width < 1400:
        escala = 1400 / r.width
        r = r.resize((int(r.width * escala), int(r.height * escala)), Image.LANCZOS)
    return r


def leer_precio(imagen_gris, angulos):
    """Modo rápido: prueba cada giro y se detiene en cuanto encuentra el valor a cobrar."""
    tracking = None
    for angulo in angulos:
        r = preparar(imagen_gris, angulo)
        for psm in (11, 6):
            texto = pytesseract.image_to_string(r, config=f'--psm {psm} -l eng')
            t, _ = extraer_datos(texto)
            if t and not tracking:
                tracking = t
            valor = extraer_valor(texto)
            if valor:
                return tracking, valor
    return tracking, None


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

    if sys.argv[1] == '--price':
        ruta = sys.argv[2] if len(sys.argv) > 2 else ''
        angulos = [int(a) for a in sys.argv[3].split(',')] if len(sys.argv) > 3 else [0, 90, 270, 180]
        if not os.path.exists(ruta):
            print(json.dumps({"ok": False, "error": "Archivo no encontrado"}))
            sys.exit(1)
        try:
            tracking, valor = leer_precio(Image.open(ruta).convert('L'), angulos)
            print(json.dumps({"ok": True, "tracking_number": tracking, "shipping_cost": valor}))
        except Exception as e:
            print(json.dumps({"ok": False, "error": str(e)}))
            sys.exit(1)
        return

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
