# Runbook Triển khai — Deploy Runbook

**Dành cho:** platform-team và on-call engineer.
**Tham chiếu:** `assets/policies/deployment-policy.md`, `SLA.md`, `deploy/deploy.sh`.

## 1. Điều kiện tiên quyết

- [ ] `npm test` pass trên branch cần triển khai
- [ ] `npm run build` pass (bao gồm audit + SAST)
- [ ] `npm run metrics` không có regression
- [ ] Backup DB gần nhất thành công (kiểm tra logs backup)
- [ ] Rollback plan: commit trước triển khai được ghi nhận; DB migration có script `down`
- [ ] Thông báo nhóm vận hành (ít nhất 30 phút trước với thay đổi thông thường, 24h với bảo trì)

## 2. Triển khai lên production (Ubuntu VPS / Render)

1. Xác nhận lại branch: `git status`, đang ở `main`, `git pull origin main`.
2. Chạy dry-run (nếu có): `npm run check:publish-output`.
3. Deploy: `bash deploy/deploy.sh` (hoặc trigger Render auto-deploy từ `main`).
4. Theo dõi build log: nghiệm thu bước `npm ci`, `npm run build`, restart service.
5. Kiểm tra sức khoẻ:
   - `curl -fsS https://<host>/api/health` → phải trả `{"status":"ok"}`
   - Trang chủ `/` redirect đúng ngôn ngữ; `/en`, `/vi`, `/fr` render bình thường
   - Một trang sản phẩm bất kỳ render đúng và giá hiển thị đúng
6. Theo dõi 30 phút: error rate, p95 latency qua log / OTLP (`src/otel.js`).
7. Ghi nhận triển khai vào DORA metrics (tag release nếu có).

## 3. Rollback (khi phát hiện sự cố)

1. **Dừng triển khai**: tắt auto-deploy trên Render nếu đang chạy.
2. **Rollback code**: `git revert <commit>` hoặc redeploy commit trước qua Render "Redeploy previous".
3. **Rollback DB** (nếu migration đã chạy): áp dụng script `down` tương ứng; kiểm tra data integrity trước khi mở lại traffic.
4. **Xác minh**: `/api/health` ok, trang sản phẩm load được, không lỗi 5xx trong log.
5. **Thông báo**: cập nhật trạng thái cho nhóm và khách hàng (nếu ảnh hưởng).
6. **Ghi nhận sự cố**: mở incident, chạy postmortem trong 48h (`npm run incident:postmortem`).

## 4. Sau triển khai

- Cập nhật service catalog: thêm/sửa `services/<id>.json` (kiểm bởi `npm run catalog:check`)
- Cập nhật `metrics-baseline.json` nếu metrics cải thiện có chủ đích.
- Nếu triển khai phát sinh lỗi → ghi nhận vào defect tracker (`npm run defect:escape`).

## 5. Sự cố thường gặp

| Triệu chứng | Nguyên nhân thường gặp | Xử lý |
|-------------|------------------------|-------|
| Health check fail ngay sau deploy | Env thiếu / sai | Kiểm tra `src/config.js`, đối chiếu env trên Render |
| Trang sản phẩm trống | R2 không truy cập được | Kiểm tra R2 credentials, `npm run r2:cors` |
| Thanh toán lỗi | PayPal keys sai | Kiểm tra `PAYPAL_*` trong env; chạy `npm run paypal:detect` |
| 5xx tăng đột ngột | Migration lỗi / code lỗi | Rollback ngay, sau đó điều tra log |
| Email không gửi | Resend API key sai/hết quota | Kiểm tra `RESEND_API_KEY`; `npm run email:check` |

---
*SonVuDev Store — Deploy Runbook v1.0 — 2026-11-04*
