FROM node:24-bookworm-slim

# LibreOffice: PPTX/DOCX fayllarni PDF ga aylantirish uchun (brauzerda ko'rsatiladi)
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-impress libreoffice-writer fonts-dejavu fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea fonts-inter ffmpeg fontconfig \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src

ENV NODE_ENV=production DATA_DIR=/data HOME=/tmp PORT=3000
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
