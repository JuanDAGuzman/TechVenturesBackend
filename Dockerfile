FROM node:20-alpine

# Instalar Python 3, Tesseract OCR y datos de idioma español/inglés
RUN apk add --no-cache \
    python3 \
    py3-pip \
    py3-pillow \
    tesseract-ocr \
    tesseract-ocr-data-spa \
    tesseract-ocr-data-eng

# Instalar pytesseract (wrapper Python para Tesseract)
RUN pip3 install --no-cache-dir --break-system-packages pytesseract

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN mkdir -p /app/uploads && chown -R node:node /app
USER node

EXPOSE 4000
CMD ["node", "server.js"]
