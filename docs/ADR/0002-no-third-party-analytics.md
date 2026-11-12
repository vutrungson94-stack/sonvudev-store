# ADR 0002 — Không analytics bên thứ ba; đo bằng RUM cùng origin

- **Status:** Accepted
- **Ngày:** 2026-11-10
- **Liên quan:** `src/app.js` (CSP), `public/quality.js`, `src/pages.js`, `docs/QUALITY-L4-L5-BACKLOG.md`

## Bối cảnh

Trang từng nạp Cloudflare Web Analytics (10 KB JS, cache TTL 1 ngày) và GA4.
Hai cái đều là script bên thứ ba:

- GA4 bị mọi tracker blocker chặn — người dùng tự chặn, không thu được gì.
- Cloudflare beacon nạp trên critical path và kéo theo polyfill
  (`Array.prototype.at/findLast/includes`) → Lighthouse "Legacy JavaScript".
- Cả hai đều là request ra origin thứ hai, phá `default-src 'self'`.

## Quyết định

- **Không** nạp script bên thứ ba nào. CSP `script-src 'self'`.
- Đo lường bằng `public/quality.js` → `POST /api/quality` trên **cùng origin**,
  dùng `navigator.sendBeacon` (sống sót khi khách rời trang, không bị proxy/VPN
  hay blocker chặn).
- Event `sonvudev:search` + `dataLayer.site_search` phát từ client; không tự gắn
  GA4/Matomo. Chủ sở hữu gắn analytics tùy chọn ở tầng ngoài.

## Hệ quả

- Không còn request ngoài origin; CSP tối thiểu; Lighthouse sạch mục third-party.
- Mất dữ liệu của những khách đang dùng GA4 (nếu từng có). Đề đổi lấy tính
  nhất quán origin và khả năng chống chặn.

## Thay thế

Muốn đưa GA4/Cloudflare về: phải mở lại CSP, nạp lại script, và chấp nhận hai
cảnh báo Lighthouse quay lại. Không làm.
