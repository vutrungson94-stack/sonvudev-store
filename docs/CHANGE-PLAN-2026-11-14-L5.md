# Change plan — 2026-11-14 — L5: đo lường, backup drill, build xác định

rev: 1

task: "Làm các hạng mục P1 còn lại của lộ trình L5: restore drill cho backup, deterministic build, process SLO, traceability matrix."

scope:
  - file: scripts/backup-drill.mjs
    region: "mới — chạy backup local, khôi phục vào thư mục tạm, đối chiếu checksum/row count, in PASS/FAIL"
  - file: scripts/build-web.mjs
    region: "loại timestamp volatile khỏi artifact/provenance hash để 2 build cùng source cho cùng hash"
  - file: scripts/provenance.mjs
    region: "hash chỉ trên nội dung ổn định; volatile files bị loại có chủ đích"
  - file: package.json
    region: "script backup:drill"
  - file: docs/RUNBOOK.md
    region: "thêm mục restore drill (chạy hằng tháng)"
  - file: docs/PROCESS-SLO.md
    region: "mới — SLO của chính quy trình (CI, flaky, restore)"
  - file: docs/TRACEABILITY.md
    region: "mới — ma trận yêu cầu → test"
  - file: docs/CMMI-L5-ROADMAP.md / docs/QUALITY-L4-L5-BACKLOG.md / PROCESS.md
    region: "đánh dấu hạng mục đã làm, thêm nhắc restore drill hằng tháng"

why: |
  Roadmap L5 (docs/CMMI-L5-ROADMAP.md §7): backup chưa khôi phục được thì chưa phải backup;
  build không xác định hash khiến "cái đã deploy là cái đã test" không chứng minh được;
  SLO của chính quy trình và traceability matrix chưa có; chính sách
  CMMI L5 đòi bằng chứng chứ không đòi tuyên bố.

invariants_checked:
  - "không đổi hành vi runtime của storefront; không đổi dependency"
  - "không hạ ngưỡng gate nào; coverage giữ >= 70/60/70"
  - "drill restore KHÔNG ghi đè production — chỉ so khớp read-only"

tests:
  existing: "npm test — 627 xanh"
  added: []
  changed: "none (docs + scripts mới)"

risk:
  wrong_behavior: "backup drill báo PASS giả vì chỉ kiểm tra tồn tại file"
  detection: "drill so checksum từng byte + đếm dòng/khoá bắt buộc + so row-count Supabase read-only"

verified:
  - cmd: "npm run backup:drill (sau npm run backup)"
    result: "PASS — 8 sản phẩm đủ id/slug/name/price; orders parse; supabase-products/orders khớp số dòng live (8/8, 2/2); restore mô phỏng 4/4 byte-identical"
  - cmd: "build ×2 liên tiếp"
    result: "PASS — cùng source → cùng `tree-sha256` (f8345b78…, 190 files) cho publish-output/node"
  - cmd: "npm run lint; npm run case; npm run audit; npm run workflow"
    result: "PASS — 200 JS files; 373 refs; 33 nhóm audit; 3 workflows"
  - cmd: "npm test; npm run metrics; npm run build"
    result: "PASS — 627 tests / 89 files; metrics không lùi (deploymentFrequency 2.72/tuần); build PASS"
  - cmd: "npm run dora:metrics"
    result: "2.72 deploys/tuần, leadTime 0.01 ngày, changeFailureRate 11.4%, mttr 1.3 ngày — baseline đã cập nhật về số thật"
  - cmd: "_Sync/gsync.ps1 -Project . -Yes"
    result: "sẽ ghi nhận commit + push"
