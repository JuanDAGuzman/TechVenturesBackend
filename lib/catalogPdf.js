import fs from "fs";
import path from "path";
import dayjs from "dayjs";

const PAGE_MARGIN = 40;
const BRAND_COLOR = "#6d28d9";
const TEXT_DARK = "#0f172a";
const TEXT_MUTED = "#64748b";
const TEXT_LIGHT = "#94a3b8";
const BORDER = "#e2e8f0";
const PLACEHOLDER_BG = "#f1f5f9";

function formatCOP(n) {
  return `$ ${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(Number(n) || 0)}`;
}

function formatWhatsappDisplay(raw) {
  const digits = (raw || "").replace(/\D/g, "");
  const local = digits.length === 12 && digits.startsWith("57") ? digits.slice(2) : digits;
  if (local.length !== 10) return local || raw || "";
  return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
}

// Carga la imagen de un producto como Buffer, sin importar si es una URL
// externa (serpapi/google), una ruta local /uploads/... o un data: URL.
async function fetchImageBuffer(imageUrl, uploadsRoot) {
  if (!imageUrl) return null;
  try {
    if (imageUrl.startsWith("data:")) {
      const base64 = imageUrl.split(",")[1];
      return base64 ? Buffer.from(base64, "base64") : null;
    }
    if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const r = await fetch(imageUrl, { signal: controller.signal });
        if (!r.ok) return null;
        return Buffer.from(await r.arrayBuffer());
      } finally {
        clearTimeout(timeout);
      }
    }
    const filePath = path.join(uploadsRoot, "..", imageUrl.replace(/^\//, ""));
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function drawPlaceholder(doc, x, y, size) {
  doc.save();
  doc.roundedRect(x, y, size, size, 6).fill(PLACEHOLDER_BG);
  doc.restore();
}

function drawCoverPage(doc, products, settings) {
  const { width, height } = doc.page;

  doc.rect(0, 0, width, height).fill("#f8fafc");
  doc.rect(0, 0, width, 10).fill(BRAND_COLOR);

  doc
    .fillColor(BRAND_COLOR)
    .font("Helvetica-Bold")
    .fontSize(36)
    .text("TechVenturesCO", PAGE_MARGIN, 140, {
      align: "center",
      width: width - PAGE_MARGIN * 2,
    });

  doc
    .fillColor(TEXT_MUTED)
    .font("Helvetica")
    .fontSize(14)
    .text("Catálogo de productos disponibles", {
      align: "center",
      width: width - PAGE_MARGIN * 2,
    });

  doc.moveDown(1.5);
  doc
    .fillColor(TEXT_LIGHT)
    .fontSize(10)
    .text(`Generado el ${dayjs().format("DD/MM/YYYY")} · ${products.length} producto${products.length !== 1 ? "s" : ""} disponible${products.length !== 1 ? "s" : ""}`, {
      align: "center",
      width: width - PAGE_MARGIN * 2,
    });

  const boxW = width - PAGE_MARGIN * 2;
  const boxH = 110;
  const boxY = height - boxH - 70;

  doc.roundedRect(PAGE_MARGIN, boxY, boxW, boxH, 12).fillAndStroke("#ffffff", BORDER);

  doc
    .fillColor(TEXT_DARK)
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("Contáctanos", PAGE_MARGIN + 24, boxY + 20);

  const lines = [];
  if (settings.whatsapp_number) {
    lines.push(`WhatsApp: ${formatWhatsappDisplay(settings.whatsapp_number)}`);
  }
  lines.push("Web: techventuresco.com");
  if (settings.instagram_handle) {
    lines.push(`Instagram: ${settings.instagram_handle}`);
  }
  if (settings.trade_in_note) {
    lines.push(settings.trade_in_note);
  }
  if (settings.payment_methods) {
    lines.push(settings.payment_methods);
  }

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(TEXT_MUTED)
    .text(lines.join("\n"), PAGE_MARGIN + 24, boxY + 42, {
      width: boxW - 48,
      lineGap: 4,
    });
}

function drawCategoryHeader(doc, name, color, count, contentWidth) {
  const barH = 30;
  const y = doc.y;

  doc.roundedRect(PAGE_MARGIN, y, contentWidth, barH, 6).fill(color || TEXT_MUTED);

  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(name.toUpperCase(), PAGE_MARGIN + 14, y + 8, { lineBreak: false });

  doc
    .font("Helvetica")
    .fontSize(9)
    .text(`${count} producto${count !== 1 ? "s" : ""}`, PAGE_MARGIN, y + 10, {
      width: contentWidth - 14,
      align: "right",
      lineBreak: false,
    });

  doc.y = y + barH + 12;
}

async function drawProductCard(doc, x, y, w, h, product, imageBuffers, uploadsRoot) {
  doc.roundedRect(x, y, w, h, 8).fillAndStroke("#ffffff", BORDER);

  const imgSize = h - 24;
  const imgX = x + 12;
  const imgY = y + 12;

  const buf = imageBuffers.get(product.id);
  let drewImage = false;
  if (buf) {
    try {
      doc.save();
      doc.roundedRect(imgX, imgY, imgSize, imgSize, 6).clip();
      doc.image(buf, imgX, imgY, { fit: [imgSize, imgSize], align: "center", valign: "center" });
      doc.restore();
      drewImage = true;
    } catch {
      drewImage = false;
    }
  }
  if (!drewImage) drawPlaceholder(doc, imgX, imgY, imgSize);

  const textX = imgX + imgSize + 14;
  const textW = x + w - textX - 14;

  doc
    .fillColor(TEXT_DARK)
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(product.name, textX, y + 14, { width: textW, height: 32, ellipsis: true });

  let lineY = y + 46;

  const badges = [];
  if (product.memory_capacity) badges.push(product.memory_capacity);
  if (product.tier) badges.push(`Gama ${product.tier}`);
  if (product.condition) {
    product.condition
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((t) => badges.push(t));
  }
  if (badges.length) {
    doc
      .fillColor(TEXT_MUTED)
      .font("Helvetica")
      .fontSize(8.5)
      .text(badges.join("  ·  "), textX, lineY, { width: textW, height: 24, ellipsis: true });
    lineY += 26;
  }

  if (product.description) {
    doc
      .fillColor(TEXT_LIGHT)
      .font("Helvetica")
      .fontSize(8)
      .text(product.description, textX, lineY, {
        width: textW,
        height: y + h - lineY - 28,
        ellipsis: true,
      });
  }

  doc
    .fillColor(BRAND_COLOR)
    .font("Helvetica-Bold")
    .fontSize(14)
    .text(formatCOP(product.price), textX, y + h - 26, { width: textW });
}

export async function buildCatalogPdf(doc, { products, categories, settings, uploadsRoot }) {
  const contentWidth = doc.page.width - PAGE_MARGIN * 2;

  const imageBuffers = new Map();
  await Promise.all(
    products.map(async (p) => {
      const buf = await fetchImageBuffer(p.image_url, uploadsRoot);
      if (buf) imageBuffers.set(p.id, buf);
    })
  );

  drawCoverPage(doc, products, settings);

  const byCategory = new Map();
  products.forEach((p) => {
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category).push(p);
  });

  const orderedCategories = categories
    .filter((c) => byCategory.has(c.name))
    .map((c) => ({ name: c.name, color: c.color, items: byCategory.get(c.name) }));

  byCategory.forEach((items, name) => {
    if (!orderedCategories.find((c) => c.name === name)) {
      orderedCategories.push({ name, color: TEXT_MUTED, items });
    }
  });

  const gap = 16;
  const cardW = (contentWidth - gap) / 2;
  const cardH = 130;

  for (const cat of orderedCategories) {
    doc.addPage();
    doc.y = PAGE_MARGIN;
    drawCategoryHeader(doc, cat.name, cat.color, cat.items.length, contentWidth);

    let y = doc.y;
    for (let i = 0; i < cat.items.length; i += 2) {
      if (y + cardH > doc.page.height - PAGE_MARGIN) {
        doc.addPage();
        y = PAGE_MARGIN;
      }
      await drawProductCard(doc, PAGE_MARGIN, y, cardW, cardH, cat.items[i], imageBuffers, uploadsRoot);
      if (cat.items[i + 1]) {
        await drawProductCard(doc, PAGE_MARGIN + cardW + gap, y, cardW, cardH, cat.items[i + 1], imageBuffers, uploadsRoot);
      }
      y += cardH + gap;
    }
  }
}
