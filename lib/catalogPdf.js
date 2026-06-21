import fs from "fs";
import path from "path";

const PAGE_MARGIN = 40;
const BRAND_COLOR = "#6d28d9";
const TEXT_DARK = "#0f172a";
const TEXT_MUTED = "#64748b";
const TEXT_LIGHT = "#94a3b8";
const BORDER = "#e2e8f0";
const PLACEHOLDER_BG = "#f1f5f9";

const ASSETS_DIR = path.join(import.meta.dirname, "..", "assets");
const LOGO_PATH = path.join(ASSETS_DIR, "techvent-logo.png");
const ICON_PATH = path.join(ASSETS_DIR, "techvent-icon.png");

function formatCOP(n) {
  return `$ ${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(Number(n) || 0)}`;
}

function formatWhatsappDisplay(raw) {
  const digits = (raw || "").replace(/\D/g, "");
  const local = digits.length === 12 && digits.startsWith("57") ? digits.slice(2) : digits;
  if (local.length !== 10) return local || raw || "";
  return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
}

// Genera el link de WhatsApp con el mensaje precargado para un producto,
// igual al patrón usado en el catálogo web (CatalogoV2.jsx).
function productWaLink(product, settings) {
  const num = (product.whatsapp_number || settings.whatsapp_number || "").replace(/\D/g, "");
  if (!num) return null;
  const parts = [product.name];
  if (product.memory_capacity) parts.push(product.memory_capacity);
  if (product.condition) {
    product.condition
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((t) => parts.push(t));
  }
  const msg = `Hola, me interesa: ${parts.join(" · ")} (${formatCOP(product.price)}), ¿sigue disponible?`;
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
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

// ── Iconos vectoriales (sin emojis, dibujados con primitivas de pdfkit) ─────

function iconGlobe(doc, x, y, size, color) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size / 2 - 0.5;
  doc.save();
  doc.lineWidth(1.3).strokeColor(color);
  doc.circle(cx, cy, r).stroke();
  doc.ellipse(cx, cy, r * 0.45, r).stroke();
  doc.moveTo(x, cy).lineTo(x + size, cy).stroke();
  doc.restore();
}

function iconChat(doc, x, y, size, color) {
  const w = size;
  const h = size * 0.78;
  doc.save();
  doc.lineWidth(1.3).strokeColor(color);
  doc.roundedRect(x, y, w, h, h * 0.28).stroke();
  doc
    .moveTo(x + w * 0.2, y + h)
    .lineTo(x + w * 0.12, y + h + size * 0.18)
    .lineTo(x + w * 0.42, y + h)
    .closePath()
    .fillAndStroke(color, color);
  doc.fillColor(color);
  [0.28, 0.5, 0.72].forEach((f) => {
    doc.circle(x + w * f, y + h / 2, 1.2).fill();
  });
  doc.restore();
}

function iconInstagram(doc, x, y, size, color) {
  doc.save();
  doc.lineWidth(1.3).strokeColor(color);
  doc.roundedRect(x, y, size, size, size * 0.28).stroke();
  doc.circle(x + size / 2, y + size / 2, size * 0.24).stroke();
  doc.circle(x + size * 0.78, y + size * 0.22, size * 0.06).fill(color);
  doc.restore();
}

function iconCard(doc, x, y, size, color) {
  const h = size * 0.7;
  const yy = y + (size - h) / 2;
  doc.save();
  doc.lineWidth(1.3).strokeColor(color);
  doc.roundedRect(x, yy, size, h, h * 0.18).stroke();
  doc.rect(x, yy + h * 0.32, size, h * 0.16).fill(color);
  doc.restore();
}

// ── Páginas ──────────────────────────────────────────────────────────────

function drawCoverPage(doc, products, categories, settings) {
  const { width, height } = doc.page;

  doc.rect(0, 0, width, height).fill("#f8fafc");
  doc.rect(0, 0, width, 8).fill(BRAND_COLOR);

  // Círculo decorativo detrás del logo
  doc.save();
  doc.fillOpacity(0.06);
  doc.circle(width / 2, 190, 170).fill(BRAND_COLOR);
  doc.restore();

  if (fs.existsSync(LOGO_PATH)) {
    const logoW = 300;
    const logoH = logoW * (600 / 900);
    doc.image(LOGO_PATH, (width - logoW) / 2, 70, { width: logoW, height: logoH });
  }

  doc
    .fillColor(TEXT_MUTED)
    .font("Helvetica")
    .fontSize(14)
    .text("Catálogo de productos disponibles", PAGE_MARGIN, 300, {
      align: "center",
      width: width - PAGE_MARGIN * 2,
    });

  // Insignia con el total de productos
  const badgeText = `${products.length} producto${products.length !== 1 ? "s" : ""} disponible${products.length !== 1 ? "s" : ""}`;
  doc.font("Helvetica-Bold").fontSize(10);
  const badgeW = doc.widthOfString(badgeText) + 28;
  const badgeH = 24;
  const badgeX = (width - badgeW) / 2;
  const badgeY = 332;
  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, badgeH / 2).fill(BRAND_COLOR);
  doc.fillColor("#ffffff").text(badgeText, badgeX, badgeY + 8, { width: badgeW, align: "center" });

  // Índice de secciones (pastillas con el color de cada categoría)
  doc
    .fillColor(TEXT_LIGHT)
    .font("Helvetica")
    .fontSize(9)
    .text("Secciones de este catálogo", PAGE_MARGIN, badgeY + 48, {
      align: "center",
      width: width - PAGE_MARGIN * 2,
    });

  const maxW = width - PAGE_MARGIN * 2;
  const pillH = 22;
  const pillGap = 8;
  const pillPadX = 12;

  doc.font("Helvetica-Bold").fontSize(9);
  const rows = [];
  let row = [];
  let rowW = 0;
  categories.forEach((c) => {
    const w = doc.widthOfString(c.name.toUpperCase()) + pillPadX * 2;
    const extra = row.length ? pillGap : 0;
    if (rowW + extra + w > maxW && row.length) {
      rows.push(row);
      row = [];
      rowW = 0;
    }
    row.push({ name: c.name, color: c.color, w });
    rowW += (row.length > 1 ? pillGap : 0) + w;
  });
  if (row.length) rows.push(row);

  let py = badgeY + 70;
  rows.forEach((r) => {
    const totalW = r.reduce((s, p) => s + p.w, 0) + pillGap * (r.length - 1);
    let px = (width - totalW) / 2;
    r.forEach((p) => {
      doc.roundedRect(px, py, p.w, pillH, pillH / 2).fill(p.color || TEXT_MUTED);
      doc.fillColor("#ffffff").text(p.name.toUpperCase(), px, py + 7.5, { width: p.w, align: "center" });
      px += p.w + pillGap;
    });
    py += pillH + pillGap;
  });

  // Aviso: las tarjetas de producto son clicables y abren WhatsApp
  const hintText = "Toca el producto que te interese para escribirnos por WhatsApp";
  doc.font("Helvetica-Bold").fontSize(10);
  const hintIconSize = 13;
  const hintTextW = doc.widthOfString(hintText);
  const hintTotalW = hintIconSize + 8 + hintTextW;
  const hintX = (width - hintTotalW) / 2;
  const hintY = py + 14;
  iconChat(doc, hintX, hintY - 1, hintIconSize, BRAND_COLOR);
  doc
    .fillColor(BRAND_COLOR)
    .text(hintText, hintX + hintIconSize + 8, hintY, { lineBreak: false });

  // Tarjeta de contacto
  const boxW = width - PAGE_MARGIN * 2;
  const boxH = 198;
  const boxY = height - boxH - 40;

  doc.roundedRect(PAGE_MARGIN, boxY, boxW, boxH, 12).fillAndStroke("#ffffff", BORDER);

  doc
    .fillColor(TEXT_DARK)
    .font("Helvetica-Bold")
    .fontSize(13)
    .text("Contáctanos", PAGE_MARGIN + 24, boxY + 18);

  const iconSize = 18;
  const iconX = PAGE_MARGIN + 24;
  const textX = iconX + iconSize + 12;
  const textW = boxW - (textX - PAGE_MARGIN) - 24;
  let rowY = boxY + 50;
  const linkW = boxW - 48;
  const rowH = 28;

  // Sitio web, WhatsApp e Instagram — mismo tamaño y alineación para que se
  // vean como un mismo grupo de enlaces.
  doc.font("Helvetica-Bold").fontSize(13);

  doc.link(iconX, rowY - 2, linkW, rowH, "https://techventuresco.com");
  iconGlobe(doc, iconX, rowY, iconSize, BRAND_COLOR);
  doc
    .fillColor(BRAND_COLOR)
    .text("Techventuresco.com", textX, rowY + 4, { width: textW, underline: true });
  rowY += rowH;

  if (settings.whatsapp_number) {
    const waDigits = settings.whatsapp_number.replace(/\D/g, "");
    doc.link(iconX, rowY - 2, linkW, rowH, `https://wa.me/${waDigits}`);
    iconChat(doc, iconX, rowY, iconSize, BRAND_COLOR);
    doc
      .fillColor(BRAND_COLOR)
      .text(`WhatsApp: ${formatWhatsappDisplay(settings.whatsapp_number)}`, textX, rowY + 4, {
        width: textW,
        underline: true,
      });
    rowY += rowH;
  }

  if (settings.instagram_handle) {
    const igHandle = settings.instagram_handle.replace(/^@/, "");
    doc.link(iconX, rowY - 2, linkW, rowH, `https://instagram.com/${igHandle}`);
    iconInstagram(doc, iconX, rowY, iconSize, BRAND_COLOR);
    doc
      .fillColor(BRAND_COLOR)
      .text(`Instagram: ${settings.instagram_handle}`, textX, rowY + 4, {
        width: textW,
        underline: true,
      });
    rowY += rowH;
  }

  doc
    .moveTo(PAGE_MARGIN + 24, rowY + 4)
    .lineTo(PAGE_MARGIN + boxW - 24, rowY + 4)
    .strokeColor(BORDER)
    .lineWidth(1)
    .stroke();
  rowY += 18;

  if (settings.payment_methods) {
    iconCard(doc, iconX, rowY - 2, iconSize, TEXT_MUTED);
    doc
      .fillColor(TEXT_MUTED)
      .font("Helvetica")
      .fontSize(9)
      .text(settings.payment_methods, textX, rowY, { width: textW, lineGap: 2 });
    rowY = doc.y + 6;
  }

  if (settings.trade_in_note) {
    doc
      .fillColor(TEXT_LIGHT)
      .font("Helvetica-Oblique")
      .fontSize(9)
      .text(settings.trade_in_note, textX, rowY, { width: textW });
  }
}

function drawCategoryHeader(doc, name, color, count, contentWidth) {
  const barH = 34;
  const y = doc.y;

  doc.roundedRect(PAGE_MARGIN, y, contentWidth, barH, 6).fill(color || TEXT_MUTED);

  const badgeSize = 26;
  const badgeX = PAGE_MARGIN + 4;
  const badgeY = y + (barH - badgeSize) / 2;
  let textX = PAGE_MARGIN + 14;

  if (fs.existsSync(ICON_PATH)) {
    doc.roundedRect(badgeX, badgeY, badgeSize, badgeSize, 5).fill("#ffffff");
    const pad = 3;
    try {
      doc.image(ICON_PATH, badgeX + pad, badgeY + pad, {
        fit: [badgeSize - pad * 2, badgeSize - pad * 2],
        align: "center",
        valign: "center",
      });
    } catch {
      // ignora si la imagen no se puede decodificar
    }
    textX = badgeX + badgeSize + 10;
  }

  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(name.toUpperCase(), textX, y + 12, { lineBreak: false });

  doc
    .font("Helvetica")
    .fontSize(9)
    .text(`${count} producto${count !== 1 ? "s" : ""}`, PAGE_MARGIN, y + 12, {
      width: contentWidth - 14,
      align: "right",
      lineBreak: false,
    });

  doc.y = y + barH + 12;
}

async function drawProductCard(doc, x, y, w, h, product, imageBuffers, uploadsRoot, settings) {
  doc.roundedRect(x, y, w, h, 8).fillAndStroke("#ffffff", BORDER);

  const waLink = productWaLink(product, settings);
  if (waLink) doc.link(x, y, w, h, waLink);

  const pad = 12;
  const imgSize = h - 24;
  const imgX = x + pad;
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
  const textW = x + w - textX - pad;

  // El nombre puede ocupar hasta 3 líneas a este ancho sin cortarse con "...".
  doc
    .fillColor(TEXT_DARK)
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(product.name, textX, y + 14, { width: textW, height: 40, ellipsis: true });

  let lineY = y + 54;

  const HIGHLIGHT_TAGS = ["NUEVO", "CON CAJA", "SELLADO"];
  const TAG_GREEN = "#059669";

  const badges = [];
  if (product.memory_capacity) badges.push({ label: product.memory_capacity, color: TEXT_MUTED });
  if (product.tier) badges.push({ label: `Gama ${product.tier}`, color: TEXT_MUTED });
  if (product.is_flagship) badges.push({ label: "Marca Insignia", color: BRAND_COLOR });
  if (product.condition) {
    product.condition
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((t) => {
        const highlighted = HIGHLIGHT_TAGS.includes(t.toUpperCase());
        badges.push({ label: t, color: highlighted ? TAG_GREEN : TEXT_MUTED });
      });
  }
  if (badges.length) {
    doc.fontSize(8.5);
    const last = badges.length - 1;
    badges.forEach((b, i) => {
      const bold = b.color !== TEXT_MUTED;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fillColor(b.color);
      const opts = i === 0
        ? { width: textW, height: 24, ellipsis: true, continued: i < last }
        : { continued: i < last };
      if (i === 0) doc.text(b.label, textX, lineY, opts);
      else doc.text(b.label, opts);
      if (i < last) doc.font("Helvetica").fillColor(TEXT_MUTED).text("  ·  ", { continued: true });
    });
    lineY += 26;
  }

  if (product.description) {
    doc
      .fillColor(TEXT_LIGHT)
      .font("Helvetica")
      .fontSize(8)
      .text(product.description, textX, lineY, {
        width: textW,
        height: y + h - lineY - 26,
        ellipsis: true,
      });
  }

  // Precio, con un aviso de "consultar por WhatsApp" al lado — toda la
  // tarjeta es clicable (ver doc.link arriba).
  const priceY = y + h - 22;
  let priceX = textX;
  let priceW = textW;
  if (waLink) {
    const hintSize = 11;
    iconChat(doc, textX, priceY + 1.5, hintSize, BRAND_COLOR);
    priceX = textX + hintSize + 6;
    priceW = textW - hintSize - 6;
  }
  doc
    .fillColor(BRAND_COLOR)
    .font("Helvetica-Bold")
    .fontSize(14)
    .text(formatCOP(product.price), priceX, priceY, { width: priceW });

  // Marca de agua de la tienda en la esquina inferior derecha de la tarjeta
  if (fs.existsSync(ICON_PATH)) {
    const wmSize = 18;
    doc.save();
    doc.opacity(0.4);
    try {
      doc.image(ICON_PATH, x + w - wmSize - 8, y + h - wmSize - 8, { width: wmSize, height: wmSize });
    } catch {
      // ignora si la imagen no se puede decodificar
    }
    doc.restore();
  }
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

  drawCoverPage(doc, products, categories, settings);

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
  const cardH = 132;

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
      await drawProductCard(doc, PAGE_MARGIN, y, cardW, cardH, cat.items[i], imageBuffers, uploadsRoot, settings);
      if (cat.items[i + 1]) {
        await drawProductCard(doc, PAGE_MARGIN + cardW + gap, y, cardW, cardH, cat.items[i + 1], imageBuffers, uploadsRoot, settings);
      }
      y += cardH + gap;
    }
  }
}
