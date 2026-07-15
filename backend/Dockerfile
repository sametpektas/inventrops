# Build Stage
FROM registry.access.redhat.com/ubi9/nodejs-20 AS builder
USER root
WORKDIR /app
COPY package*.json ./
RUN npm install --prefer-offline --no-audit
COPY . .
RUN ./node_modules/.bin/prisma generate
RUN npm run build
# Create assets directory for logo storage
RUN mkdir -p /app/assets

# Production Stage
FROM registry.access.redhat.com/ubi9/nodejs-20
USER root
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/src ./src
# Copy assets if they exist in source (logo pre-bundled with build)
COPY --from=builder /app/assets ./assets

ENV ASSETS_DIR=/app/assets

EXPOSE 8007
CMD ["sh", "-c", "echo 'Syncing database...'; ./node_modules/.bin/prisma db push --schema=prisma/schema.prisma --accept-data-loss && node dist/index.js"]
