FROM node:22-alpine AS builder
USER root
WORKDIR /app
COPY . .
# Note: node_modules must exist on host for offline builds
RUN npm run build

FROM nginx:stable-alpine
USER root
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
