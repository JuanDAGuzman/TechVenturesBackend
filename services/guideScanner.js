// Lectura de guías de envío a partir de una foto.
//
//  1. El número de guía sale del código de barras (Code 128) o del QR de la guía: se leen en milisegundos y
//     no se equivocan de dígito como el OCR.
//  2. El código de barras también indica cuánto está girada la foto. Con ese ángulo se endereza la imagen
//     (aunque esté inclinada) antes de leer el "Valor a cobrar" con OCR, que solo existe como texto.
//  3. La foto se reduce a 1600 px: una foto de celular completa hacía el OCR muy lento.
//
// Si no hay código legible, el número de guía se busca en el texto, como antes.

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "..", "ocr", "extract_guide.py");
const MAX_SIDE = 1600;
const TRACKING_RE = /^\d{10,16}$/;

// Las librerías de imagen se cargan al escanear (no al arrancar el servidor): si alguna no estuviera disponible,
// solo falla el escáner rápido y la ruta usa el método anterior, sin afectar al resto del backend.
let libsPromise = null;
function loadLibs() {
  if (!libsPromise) {
    libsPromise = Promise.all([import("sharp"), import("zxing-wasm/reader")])
      .then(([sharpMod, zx]) => ({ sharp: sharpMod.default, readBarcodes: zx.readBarcodes }))
      .catch((e) => {
        libsPromise = null;
        throw e;
      });
  }
  return libsPromise;
}

function runPython(args, timeoutMs = 25000) {
  const pythonCmd = process.platform === "win32" ? "python" : "python3";
  return new Promise((resolve, reject) => {
    const py = spawn(pythonCmd, [SCRIPT, ...args]);
    let out = "";
    let err = "";
    py.stdout.on("data", (d) => (out += d));
    py.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => {
      py.kill();
      reject(new Error("OCR_TIMEOUT"));
    }, timeoutMs);
    py.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`Python exited ${code}: ${err.slice(0, 200)}`));
      try {
        resolve(JSON.parse(out.trim()));
      } catch {
        reject(new Error("JSON_PARSE_ERROR"));
      }
    });
  });
}

// Número de guía: el valor numérico que más veces aparezca entre los códigos leídos
function pickTracking(results) {
  const votes = new Map();
  for (const r of results) {
    const text = String(r.text || "").trim();
    if (!TRACKING_RE.test(text)) continue;
    votes.set(text, (votes.get(text) || 0) + (r.format === "Code128" ? 2 : 1));
  }
  let best = null;
  for (const [text, score] of votes) if (!best || score > best.score) best = { text, score };
  return best?.text ?? null;
}

// Ángulo con el que hay que corregir la foto para que el texto de la guía quede derecho.
//  - El código de barras da la orientación general, pero solo en múltiplos de 90° (sus esquinas no reflejan la inclinación).
//  - El QR sí: se ubica por sus cuadros de esquina, así que da el ángulo real (en esta guía coincide con el del código de barras).
// Si ambos coinciden (con tolerancia de inclinación) se usa el del QR; si no, el del código de barras.
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const quadAngle = (p) =>
  p?.topLeft && p?.topRight ? (Math.atan2(p.topRight.y - p.topLeft.y, p.topRight.x - p.topLeft.x) * 180) / Math.PI : null;

function labelAngle(results) {
  const bar = results.find((r) => r.format === "Code128" && TRACKING_RE.test(r.text)) || results.find((r) => TRACKING_RE.test(r.text));
  const qr = results.find((r) => r.format === "QRCode" && quadAngle(r.position) !== null);
  const barAngle = bar && Number.isFinite(bar.orientation) ? bar.orientation : null;
  if (qr) {
    const fromQr = quadAngle(qr.position);
    if (barAngle === null || Math.abs(wrap180(fromQr - barAngle)) <= 25) return fromQr;
  }
  return barAngle;
}

export async function scanGuideImage(buffer) {
  const t0 = Date.now();
  const { sharp, readBarcodes } = await loadLibs();

  // Foto derecha (EXIF) y de tamaño razonable
  const baseBuf = await sharp(buffer, { failOn: "none" })
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .toBuffer();

  // 1) Códigos de barras / QR
  let results = [];
  try {
    const { data, info } = await sharp(baseBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    results = await readBarcodes(
      { data: new Uint8ClampedArray(data), width: info.width, height: info.height, colorSpace: "srgb" },
      { tryHarder: true, formats: ["Code128", "QRCode"], maxNumberOfSymbols: 4 }
    );
  } catch (e) {
    console.error("[guide-scan] barcode:", e.message);
  }
  const barcodeTracking = pickTracking(results);
  const bar = results.find((r) => r.format === "Code128" && TRACKING_RE.test(r.text)) || results.find((r) => TRACKING_RE.test(r.text));

  // 2) Enderezar con el ángulo del código y leer el valor con OCR
  let pipeline = sharp(baseBuf);
  const angle = labelAngle(results);
  if (angle !== null) {
    const rot = (((360 - angle) % 360) + 360) % 360;
    if (rot > 0.5 && rot < 359.5) pipeline = pipeline.rotate(rot, { background: "#ffffff" });
  }
  const prepared = await pipeline.grayscale().normalize().png().toBuffer();

  const tmpPath = path.join(os.tmpdir(), `guide_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`);
  let ocr = { tracking_number: null, shipping_cost: null };
  try {
    fs.writeFileSync(tmpPath, prepared);
    // Con el código leído la foto ya queda derecha (giro 0); los demás giros son respaldo
    const r = await runPython(["--price", tmpPath, "0,90,270,180"]);
    if (r?.ok) ocr = r;
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ya no existe */ }
  }

  return {
    ok: true,
    tracking_number: barcodeTracking || ocr.tracking_number || null,
    shipping_cost: ocr.shipping_cost || null,
    source: { tracking: barcodeTracking ? "barcode" : ocr.tracking_number ? "ocr" : null, barcode: !!bar },
    ms: Date.now() - t0,
  };
}
