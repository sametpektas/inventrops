# Build Stage
FROM node:22-alpine AS builder
USER root
WORKDIR /app
COPY . .
# Note: node_modules must exist on host for offline builds
RUN ./node_modules/.bin/prisma generate
RUN npm run build

# Production Stage
FROM node:22-alpine
USER root
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/src ./src

EXPOSE 8000
CMD ["sh", "-c", "echo 'Syncing database...'; ./node_modules/.bin/prisma db push --schema=prisma/schema.prisma --accept-data-loss && node dist/index.js"]
