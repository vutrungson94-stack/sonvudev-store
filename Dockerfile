# SonVuDev Store — multi-stage, cùng đường build với Render (render.yaml).
#
# Trước đây image copy source public/ rồi chạy `node src/server.js`: đó là bản
# chưa minify, không có asset-manifest hash — đúng thứ Lighthouse chụp phạt trong
# khi render.yaml đã chạy artifact. Giờ Docker cũng build artifact rồi chạy nó,
# nên "deploy bằng Docker" và "deploy bằng Render" phục vụ cùng một bytes.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# esbuild (devDependency) cần để minify ở bước build — giữ --include=dev như
# render.yaml:49. Runner chỉ cài runtime deps ở giai đoạn cuối.
RUN npm ci --include=dev --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
# The build context intentionally has no .git (.dockerignore), so the deploy
# command passes the commit it is shipping: `fly deploy --build-arg
# GIT_COMMIT=$(git rev-parse HEAD)`. /api/health reports it, and the CI
# deployed-site gate refuses to certify a release it cannot identify.
ARG GIT_COMMIT=""
ENV NODE_ENV=production
ENV GIT_COMMIT=$GIT_COMMIT
RUN addgroup -S app && adduser -S app -G app
# Chỉ artifact được đưa vào image: cùng thứ render.yaml startCommand dùng.
COPY --from=build --chown=app:app /app/publish-output/node/ ./
# Artifact không kèm node_modules (build-web.mjs chỉ copy source). Cài runtime
# deps từ lockfile đã có trong artifact, rồi chạy bằng user không-root.
RUN npm ci --omit=dev --ignore-scripts && chown -R app:app /app
# Không có Supabase → tiến trình ghi data/*.json và logs/*.log dưới /app; tạo
# sẵn và trao quyền cho user app để không chết EACCES ở lần ghi đầu tiên.
# .dockerignore vẫn giữ dữ liệu thật ngoài image.
RUN mkdir -p /app/data /app/logs && chown -R app:app /app/data /app/logs
# Khi không có Supabase có thể mount volume: docker run -v sonvudev-data:/app/data ...
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node scripts/health-check.mjs || exit 1
CMD ["npm", "start"]
