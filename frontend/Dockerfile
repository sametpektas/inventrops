FROM node:22-alpine AS builder
USER root
WORKDIR /app
COPY package*.json ./
RUN npm install --prefer-offline --no-audit
COPY . .
RUN npm run build

# Production Stage
FROM node:22-alpine
USER root
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js

EXPOSE 80
CMD ["node", "server.js"]
