FROM registry.access.redhat.com/ubi9/nodejs-20 AS builder
USER root
WORKDIR /app
COPY package*.json ./
RUN npm install --prefer-offline --no-audit
COPY . .
RUN npm run build

FROM registry.access.redhat.com/ubi9/nginx-124
USER root
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
