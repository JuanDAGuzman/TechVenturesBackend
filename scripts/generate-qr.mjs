/**
 * Genera un PNG de QR de contacto para TechVenturesCO.
 * Uso: node scripts/generate-qr.mjs [ruta-salida]
 * Salida por defecto: assets/qr-contacto.png
 */

import QRCode from "qrcode";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, "..", "assets");

const WA_NUMBER = "573108216274"; // +57 Colombia
const WA_URL = `https://wa.me/${WA_NUMBER}`;
const DISPLAY_NUMBER = "310 821 6274";

const BRAND_COLOR = "#6d28d9";
const SIZE = 1200; // px total del canvas
const PADDING = 60;
const QR_SIZE = 720;
const LOGO_H = 140;
const LOGO_W = 440;
const ICON_SIZE = 120; // logo pequeño en el centro del QR

async function main() {
  const outPath = process.argv[2] ?? path.join(ASSETS, "qr-contacto.png");

  // 1. Generar QR en morado como PNG buffer
  const qrBuf = await QRCode.toBuffer(WA_URL, {
    type: "png",
    width: QR_SIZE,
    margin: 1,
    color: { dark: BRAND_COLOR, light: "#ffffff" },
    errorCorrectionLevel: "H", // máxima corrección → aguanta el logo encima
  });

  // 2. Preparar logo grande (arriba)
  const logoPath = path.join(ASSETS, "techvent-logo.png");
  const logoBuf = fs.existsSync(logoPath)
    ? await sharp(logoPath).resize(LOGO_W, LOGO_H, { fit: "inside" }).toBuffer()
    : null;

  // 3. Preparar icono pequeño para el centro del QR (fondo blanco cuadrado)
  const iconPath = path.join(ASSETS, "techvent-icon.png");
  let centerBuf = null;
  if (fs.existsSync(iconPath)) {
    const innerSize = Math.round(ICON_SIZE * 0.72);
    const innerBuf = await sharp(iconPath)
      .resize(innerSize, innerSize, { fit: "contain", background: "#ffffff" })
      .toBuffer();
    // Cuadrado blanco con esquinas redondeadas como fondo del icono
    const radius = 16;
    const squareSvg = `<svg width="${ICON_SIZE}" height="${ICON_SIZE}">
      <rect width="${ICON_SIZE}" height="${ICON_SIZE}" rx="${radius}" ry="${radius}" fill="#ffffff"/>
    </svg>`;
    centerBuf = await sharp({
      create: { width: ICON_SIZE, height: ICON_SIZE, channels: 4, background: "#ffffff00" },
    })
      .composite([
        { input: Buffer.from(squareSvg), top: 0, left: 0 },
        {
          input: innerBuf,
          top: Math.round((ICON_SIZE - innerSize) / 2),
          left: Math.round((ICON_SIZE - innerSize) / 2),
        },
      ])
      .png()
      .toBuffer();
  }

  // 4. Textos inferiores como SVG overlay
  const textAreaH = 160;
  const textSvg = `<svg width="${SIZE}" height="${textAreaH}" xmlns="http://www.w3.org/2000/svg">
    <text
      x="${SIZE / 2}" y="58"
      font-family="Arial, Helvetica, sans-serif"
      font-size="46" font-weight="bold"
      fill="${BRAND_COLOR}" text-anchor="middle"
    >¡Escríbenos por WhatsApp!</text>
    <text
      x="${SIZE / 2}" y="118"
      font-family="Arial, Helvetica, sans-serif"
      font-size="40"
      fill="#475569" text-anchor="middle"
    >${DISPLAY_NUMBER}</text>
  </svg>`;

  // 5. Componer todo en el canvas
  const LOGO_Y = PADDING;
  const QR_Y = LOGO_Y + LOGO_H + 36;
  const TEXT_Y = QR_Y + QR_SIZE + 20;
  const TOTAL_H = TEXT_Y + textAreaH + PADDING;
  const QR_X = Math.round((SIZE - QR_SIZE) / 2);
  const CENTER_X = QR_X + Math.round((QR_SIZE - ICON_SIZE) / 2);
  const CENTER_Y = QR_Y + Math.round((QR_SIZE - ICON_SIZE) / 2);

  const composites = [];

  if (logoBuf) {
    // Centramos el logo por si quedó más pequeño por el fit:inside
    const logoMeta = await sharp(logoBuf).metadata();
    composites.push({
      input: logoBuf,
      top: LOGO_Y + Math.round((LOGO_H - (logoMeta.height ?? LOGO_H)) / 2),
      left: Math.round((SIZE - (logoMeta.width ?? LOGO_W)) / 2),
    });
  }

  composites.push({ input: qrBuf, top: QR_Y, left: QR_X });

  if (centerBuf) {
    composites.push({ input: centerBuf, top: CENTER_Y, left: CENTER_X });
  }

  composites.push({ input: Buffer.from(textSvg), top: TEXT_Y, left: 0 });

  await sharp({
    create: {
      width: SIZE,
      height: TOTAL_H,
      channels: 4,
      background: "#ffffff",
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  console.log(`✅ QR generado en: ${outPath}`);
  console.log(`   Apunta a: ${WA_URL}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
