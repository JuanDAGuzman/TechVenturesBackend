/**
 * Genera QR sin texto (solo el código y el icono del dragón al centro):
 *   - qr-whatsapp.png  -> chat de WhatsApp de TechVenturesCO
 *   - qr-web.png       -> https://www.techventuresco.com
 * Uso: node scripts/generate-qr-clean.mjs
 */

import QRCode from "qrcode";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, "..", "assets");

const WA_NUMBER = "573108216274";
const WA_MSG = "Hola TechVenturesCO, quisiera información sobre sus productos disponibles.";

const TARGETS = [
  { file: "qr-whatsapp.png", url: `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(WA_MSG)}` },
  { file: "qr-web.png", url: "https://www.techventuresco.com" },
];

const BRAND_COLOR = "#6d28d9";
const QR_SIZE = 1000;
const MARGIN_PX = 80; // zona blanca alrededor (el QR la necesita para leerse)
const SIZE = QR_SIZE + MARGIN_PX * 2;
const ICON_SIZE = 190;

async function iconBuffer() {
  const iconPath = path.join(ASSETS, "techvent-icon.png");
  if (!fs.existsSync(iconPath)) return null;
  const inner = Math.round(ICON_SIZE * 0.78);
  const innerBuf = await sharp(iconPath).resize(inner, inner, { fit: "contain", background: "#ffffff" }).toBuffer();
  const bg = `<svg width="${ICON_SIZE}" height="${ICON_SIZE}"><rect width="${ICON_SIZE}" height="${ICON_SIZE}" rx="22" fill="#ffffff"/></svg>`;
  return sharp({ create: { width: ICON_SIZE, height: ICON_SIZE, channels: 4, background: "#ffffff00" } })
    .composite([
      { input: Buffer.from(bg), top: 0, left: 0 },
      { input: innerBuf, top: Math.round((ICON_SIZE - inner) / 2), left: Math.round((ICON_SIZE - inner) / 2) },
    ])
    .png()
    .toBuffer();
}

async function main() {
  const icon = await iconBuffer();
  for (const t of TARGETS) {
    const qr = await QRCode.toBuffer(t.url, {
      type: "png", width: QR_SIZE, margin: 0,
      color: { dark: BRAND_COLOR, light: "#ffffff" },
      errorCorrectionLevel: "H",
    });
    const layers = [{ input: qr, top: MARGIN_PX, left: MARGIN_PX }];
    if (icon) layers.push({ input: icon, top: Math.round((SIZE - ICON_SIZE) / 2), left: Math.round((SIZE - ICON_SIZE) / 2) });
    const out = path.join(ASSETS, t.file);
    await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: "#ffffff" } })
      .composite(layers).png({ compressionLevel: 9 }).toFile(out);
    console.log(`OK ${out}\n   -> ${t.url}`);
  }
}

main().catch((e) => { console.error("Error:", e.message); process.exit(1); });
