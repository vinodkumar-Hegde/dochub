FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json index.html ./
COPY src ./src
COPY services/api/src/subscriber-phone.ts ./services/api/src/subscriber-phone.ts
COPY public ./public
ARG VITE_API_ORIGIN=/api
ENV VITE_API_ORIGIN=$VITE_API_ORIGIN
RUN npm run build
FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O /dev/null http://127.0.0.1:8080/health/web || exit 1
