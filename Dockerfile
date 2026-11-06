# SonVuDev Store — multi-stage, chạy được trên Render/VPS mà không cần build tool ngoài.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY supabase ./supabase
COPY cloudflare ./cloudflare
COPY deploy ./deploy
COPY package.json package-lock.json render.yaml .env.example README.md ./
# Không bao giờ copy .env / data / logs / publish-output / .wrangler vào image.
# Image vẫn phải boot được chế độ local (không Supabase): lúc đó tiến trình ghi
# data/*.json và logs/*.log dưới /app mà root sở hữu còn user app không ghi được,
# container chết EACCES ở lần ghi đầu tiên thay vì phục vụ shop rỗng. Hai thư mục
# được tạo sẵn và trao quyền cho user chạy runtime; .dockerignore vẫn giữ dữ liệu
# thật ngoài image.
RUN mkdir -p /app/data /app/logs && chown -R app:app /app/data /app/logs
# Khi không có Supabase có thể mount volume: docker run -v sonvudev-data:/app/data ...
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node scripts/health-check.mjs || exit 1
CMD ["node", "src/server.js"]
