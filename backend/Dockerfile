# Build Stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN ./node_modules/.bin/prisma generate
RUN npm run build

# Production Stage
FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src

EXPOSE 8000
CMD ["sh", "-c", "until ./node_modules/.bin/prisma db push; do echo 'Waiting for database...'; sleep 2; done && node dist/index.js"]
