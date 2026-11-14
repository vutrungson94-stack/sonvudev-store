# Ma trận truy xuất — yêu cầu → test → release

Mỗi dòng là một điều quan trọng đã từng bị phá vỡ hoặc được tuyên bố là không
thương lượng (`AGENTS.md`, `WORKFLOW.md`, `docs/PURCHASE-LINK-RULES.md`,
`docs/ADR/*`). Cột "Test" trỏ tới file bảo vệ hành vi; "Lý do không test" được
ghi thẳng khi chưa có test.

| # | Yêu cầu / invariant (nguồn) | Test | Ghi chú |
| --- | --- | --- | --- |
| 1 | Mọi hành động "Mua hàng" dùng `/?buy=<id>` + `openPurchaseForm`; liên kết khám phá đi tới trang sản phẩm (`AGENTS.md` §4, `PURCHASE-LINK-RULES.md`) | `test/purchase-link-contract.test.js` | — |
| 2 | CTA mua phải mở form mua trực tiếp, không mở modal chi tiết (`AGENTS.md`) | `test/purchase-link-contract.test.js` | — |
| 3 | `rel="nofollow"` cho mọi link `/?buy=`; canonical chỉ một địa chỉ; `/x/` trả 308 về `/x` (`docs/ADR/0001`) | `test/trailing-slash.test.js`, `test/purchase-link-contract.test.js` | — |
| 4 | Content sản phẩm phải đi qua `src/`/`public/`, không qua `data/` runtime (`content-ships`, `AGENTS.md` §4) | `test/content-ships.test.js` | — |
| 5 | Giá trong feed/schema = giá niêm yết VND của sản phẩm, không quy đổi USD hardcode (`AGENTS.md` §4, GMC) | `test/merchant-policy.test.js`, `test/merchant-feed.test.js` | — |
| 6 | Không `AggregateRating`/sao tự thu thập (`AGENTS.md` §4, `docs/ADR/0003`) | `test/review.test.js` | — |
| 7 | `merchant-policy`: không scarcity/discount claims trong product data/blog/locales; checkout hiển thị giá trước khi cam kết (`AGENTS.md` §4) | `test/merchant-policy.test.js` | — |
| 8 | Repo ↔ live parity: product data/copy phải kết thúc bằng `ops:catalog:apply` (`WORKFLOW §7.6`, `AGENTS.md` §4) | quy trình §7.6; không có test tự động (cần admin token live) | Lý do không test: test sẽ ghi live thật; thay bằng bước bắt buộc trong WORKFLOW |
| 9 | Refund story một câu chuyện: contact/FAQ/checkout không hứa hoàn tiền "mua nhầm" khác `refund.html` (`AGENTS.md` §4) | `test/merchant-policy.test.js`, `test/refund.test.js` | — |
| 10 | Không redirect theo ngôn ngữ trình duyệt; locale prefix thắng storage (`WORKFLOW.md` §7.5) | `test/blog.test.js` | — |
| 11 | Stylesheet được inline; preload font đúng 4 subset; `font-display: optional` (`WORKFLOW.md` §7.5) | `test/pwa-and-fonts.test.js`, `test/font-preload.test.js`, `test/font-coverage.test.js`, `test/styles-min.test.js` | — |
| 12 | Buy page + product page + blog có OG image đúng kích thước, absolute URL (`AGENTS.md` §5) | `test/seo.test.js`, `test/seo-check-cli.test.js` | — |
| 13 | Không bên thứ ba nào trong trang; analytics chỉ của shop (`AGENTS.md` §7.5) | `test/analytics-defer.test.js`, `test/chrome.test.js` | — |
| 14 | Mobile first-load order: defer scripts, i18n.js không parser-blocking (`WORKFLOW.md` §7.5) | `test/pwa-and-fonts.test.js` | — |
| 15 | `main` = deploy được bất cứ lúc nào; branch protection | cấu hình GitHub (không nằm trong repo) | Lý do không test: ngoài phạm vi repo |
| 16 | Health `/api/health` trả đúng trạng thái storage/PayPal/mail (`SLA.md`) | `test/health-check.test.js` | — |
| 17 | Rate limit + auth admin có chống lạm dụng (`SLA.md`) | `test/rate-limit.test.js`, `test/admin-auth.test.js` | — |
| 18 | Release artifact kèm provenance/SBOM; hash ổn định giữa các build (`PROCESS.md` §5, `CMMI-L5-ROADMAP §7`) | `test/provenance.test.js`, `scripts/provenance.mjs`, verify build ×2 | — |
| 19 | Backup khôi phục được (`CMMI-L5-ROADMAP §7`) | `scripts/backup.mjs`, `scripts/backup-drill.mjs` (mới 2026-11-14) | Drill hằng tháng, xem RUNBOOK §8 |
| 20 | RCA/postmortem sau mỗi sự cố production (`PROCESS.md` §3, `§10`) | `test/workflow-gate.test.js`? (gate CI) | Quy trình bắt buộc; bằng chứng: `docs/rca/*`, `postmortems/*` |

## Vòng phản hồi lỗi → phòng ngừa

| Sự cố (postmortem/RCA) | Nguyên nhân gốc | Gate phòng ngừa |
| --- | --- | --- |
| GSC trang trùng lặp 2026-11-12 | `/?buy=` byte-identical homepage + trailing slash 200 | `test/trailing-slash.test.js`, `docs/ADR/0001` |
| GMC Trình bày sai 2026-11-14 (8/8 sản phẩm) | live Supabase lệch repo + checkout không hiện giá + danh tính yếu | `test/merchant-policy.test.js` (claims/checkout), `WORKFLOW §7.6` (parity), `AGENTS §4` |

## Quy ước

- Test mới cho hành vi mới được ưu tiên hơn sửa test cũ.
- Khi một hành vi chỉ kiểm được trên live (ví dụ GMC re-crawl), ghi rõ vào
  `docs/CHANGE-PLAN-*.md` thay vì bịa test.
- Ma trận này được cập nhật trong cùng PR với thay đổi liên quan.
