FROM registry.access.redhat.com/ubi9/nodejs-20 AS builder
USER root
WORKDIR /app
COPY package*.json ./
RUN npm install --prefer-offline --no-audit
COPY . .
RUN npm run build

FROM registry.access.redhat.com/ubi9/nodejs-20
USER root
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --prefer-offline --no-audit
COPY --from=builder /app/dist ./dist
COPY server.js ./
EXPOSE 80
CMD ["node", "server.js"]
