FROM node:20-bookworm-slim AS build

# Tesseract + poppler-utils (used by pdf2pic) are required at build-time for
# native bindings that ship with node-tesseract-ocr — and at runtime for the
# actual OCR pass.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-eng poppler-utils ghostscript graphicsmagick \
      build-essential python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile=false

COPY . .
RUN pnpm build

FROM node:20-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-eng poppler-utils ghostscript graphicsmagick ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "dist/main.js"]
