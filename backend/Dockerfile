# Build Stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Bust cache to ensure the new schema.prisma is used
ARG CACHE_BUST=1

RUN ./node_modules/.bin/prisma generate
RUN npm run build

# Production Stage
FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/src ./src

EXPOSE 8000
CMD ["sh", "-c", "echo 'Applying database migrations...'; for i in $(seq 1 10); do ./node_modules/.bin/prisma db push --schema=prisma/schema.prisma --accept-data-loss && break; echo \"Database retry $i/10...\"; sleep 5; done && node dist/index.js"]
