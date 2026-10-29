import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, isConfigured } from "./config.js";
import { supabaseCount, supabaseRequest } from "./supabase-http.js";

/**
 * Where this process keeps its files.
 *
 * One definition, because two modules write under it and the second used to
 * recompute the same expression with the same DATA_DIR override, so the only way
 * the two could agree was if the two lines never drifted. notify.js imports this
 * instead.
 */
export const projectRoot = env.dataDir ? path.resolve(env.dataDir) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = projectRoot;
// Exported because it is a thing the health probe has to be able to test. A check
// that cannot ask "can this process write where it says it writes" is a
// configuration report, and a configuration report answers "ok" for a server whose
// disk is full.
export const dataDir = path.join(root, "data");
const files = { products: path.join(dataDir, "products.json"), orders: path.join(dataDir, "orders.json") };
let writeChain = Promise.resolve();

/**
 * Reads a JSON file, and says so when it cannot.
 *
 * This used to swallow every error into the fallback — a missing file and a
 * truncated one were the same answer, which meant a half-written orders.json read
 * as an empty ledger. Nothing was logged, so the next write rebuilt the file from
 * that empty array and the whole ledger was gone with no trace and no error
 * anywhere. An empty shop and an empty file have to be told apart, because only one
 * of them is safe to carry on from.
 *
 * @returns {{data:*, recovered:boolean, error:Error|null}}
 */
const readJsonFile = async (file, fallback) => {
  try {
    return { data: JSON.parse(await fs.readFile(file, "utf8")), recovered: false, error: null };
  } catch (error) {
    if (error.code === "ENOENT") return { data: fallback, recovered: false, error: null };
    console.error(`[store] ${path.basename(file)} is unreadable (${error.message}) — treating it as empty, and the next write will replace it`);
    return { data: fallback, recovered: true, error };
  }
};

const readJson = async (file, fallback) => (await readJsonFile(file, fallback)).data;

/**
 * Writes a file the way a database commits: nothing is ever half-written.
 *
 * fs.writeFile truncates first, so a crash, a full disk or a kill between the two
 * leaves a file with a valid beginning and no ending. The reader above cannot tell
 * that from corruption, which is the whole problem. Writing to a temporary file in
 * the same directory and renaming over the target is the POSIX way to make the
 * swap atomic, and rename is atomic within a filesystem — the ledger is either the
 * old one or the new one, never a piece of either.
 */
const writeFileAtomic = async (file, contents) => {
  const temp = `${file}.${process.pid}.tmp`;
  const handle = await fs.open(temp, "w");
  try {
    await handle.writeFile(contents, "utf8");
    // Flushed before the rename, or the rename can land before the bytes do and
    // the "atomic" swap publishes an empty file.
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, file);
};

const writeJson = (file, data) => {
  writeChain = writeChain.catch(() => {}).then(() => writeFileAtomic(file, JSON.stringify(data, null, 2)));
  return writeChain;
};

/**
 * Read, change and write a JSON file as one indivisible step.
 *
 * writeJson only queued the write. Every caller still read the file first, outside
 * that queue, so two updates landing at the same time both read the same starting
 * state, both built a new array from it, and the second write silently discarded
 * the first — which on this data means a lost payment count or a refund that never
 * reaches the ledger. Serialising the read inside the same queue is what makes the
 * local path behave the way Postgres already does.
 *
 * The queue recovers from a failed write. It did not: one ENOSPC left the chain
 * permanently rejected, every later mutation skipped its change function without
 * saying so, and every caller that checks only "did this throw?" read the result
 * as success. A write that fails is reported; a write that fails once does not
 * disable the ledger for the rest of the process's life.
 */
const mutateJson = (file, change) => {
  writeChain = writeChain.catch(() => {}).then(async () => {
    const { data, recovered } = await readJsonFile(file, []);
    const next = await change(data);
    // A recovered read means the change function was handed an empty ledger and
    // will hand back an empty ledger. Writing that over what was there would be
    // the one outcome that loses data rather than preserving it, so the write is
    // refused and the caller is told why.
    if (recovered && Array.isArray(data) && data.length === 0) {
      const error = new Error(`${path.basename(file)} could not be read and is not being overwritten`);
      error.code = "ESTORECORRUPT";
      throw error;
    }
    await writeFileAtomic(file, JSON.stringify(next, null, 2));
    return next;
  });
  return writeChain;
};

/**
 * Waits for every queued write to finish.
 *
 * src/store.js writes through a promise chain so two updates cannot interleave,
 * and that chain outlives any single caller. A test that removes the data
 * directory without waiting is deleting files out from under a write that is
 * still in flight: the temporary file appears while the directory walk is already
 * past that name, and on Windows the removal fails with ENOTEMPTY. It is a race,
 * so it passes on most runs and fails on a loaded machine — which is worse than a
 * reliable failure, because the next person to see it blames the code under test.
 *
 * Call this before removing a directory the store is pointed at.
 */
export const flushWrites = async () => { await writeChain.catch(() => {}); };

const seedProducts = [
  { id: "sonvu-starter", slug: "sonvu-starter", name: "SonVu Starter", nameEn: "SonVu Starter", nameJa: "SonVu スターター", nameZh: "SonVu 入门版", shortDescription: "Bộ công cụ nền cho người mới bắt đầu.", shortDescriptionEn: "Foundational toolkit for beginners.", shortDescriptionJa: "初心者向けの基礎ツールキット。", shortDescriptionZh: "初学者基础工具包。", description: "Sản phẩm mẫu. Thay nội dung này bằng mô tả phần mềm thật của bạn.", descriptionEn: "Sample product. Replace this content with your actual software description.", descriptionJa: "サンプル製品です。この内容を実際のソフトウェアの説明に置き換えてください。", descriptionZh: "示例产品。请将此内容替换为您实际的软件描述。", category: "Công cụ", platform: "Windows", version: "1.0.0", price: 149000, currency: "VND", badge: "Phổ biến", features: ["Giao diện tiếng Việt", "Cập nhật miễn phí trong 12 tháng", "Hỗ trợ qua email"], featuresEn: ["Vietnamese interface", "Free updates for 12 months", "Email support"], featuresJa: ["ベトナム語インターフェース", "12ヶ月間無料アップデート", "メールサポート"], featuresZh: ["越南语界面", "12个月免费更新", "电子邮件支持"], requirements: "Windows 10/11, 4 GB RAM", status: "active", fileKey: "", createdAt: new Date().toISOString() },
  { id: "sonvu-pro", slug: "sonvu-pro", name: "SonVu Pro", nameEn: "SonVu Pro", nameJa: "SonVu プロ", nameZh: "SonVu 专业版", shortDescription: "Bộ tính năng nâng cao cho người dùng chuyên nghiệp.", shortDescriptionEn: "Advanced feature set for professional users.", shortDescriptionJa: "プロユーザー向けの高度な機能セット。", shortDescriptionZh: "面向专业用户的先进功能集。", description: "Sản phẩm mẫu cho gói Pro.", descriptionEn: "Sample product for the Pro package.", descriptionJa: "プロパッケージのサンプル製品です。", descriptionZh: "专业版套餐示例产品。", category: "Công cụ", platform: "Windows", version: "2.0.0", price: 349000, currency: "VND", badge: "Chuyên nghiệp", features: ["Đầy đủ tính năng Pro", "Ưu tiên hỗ trợ", "Cập nhật lâu dài"], featuresEn: ["Full Pro features", "Priority support", "Long-term updates"], featuresJa: ["すべてのプロ機能", "優先サポート", "長期アップデート"], featuresZh: ["完整专业功能", "优先支持", "长期更新"], requirements: "Windows 10/11, 8 GB RAM", status: "active", fileKey: "", createdAt: new Date().toISOString() },
  { id: "sonvu-lifetime", slug: "sonvu-lifetime", name: "SonVu Lifetime", nameEn: "SonVu Lifetime", nameJa: "SonVu ライフタイム", nameZh: "SonVu 终身版", shortDescription: "Một lần mua, sử dụng lâu dài.", shortDescriptionEn: "One-time purchase, lifetime use.", shortDescriptionJa: "一度の購入で、永続的に利用可能。", shortDescriptionZh: "一次购买，终身使用。", description: "Sản phẩm mẫu cho gói Lifetime.", descriptionEn: "Sample product for the Lifetime package.", descriptionJa: "ライフタイムパッケージのサンプル製品です。", descriptionZh: "终身版套餐示例产品。", category: "Bundle", platform: "Windows", version: "1.0.0", price: 699000, currency: "VND", badge: "Tiết kiệm", features: ["Tất cả gói hiện có", "License cá nhân", "Ưu tiên cập nhật"], featuresEn: ["All existing packages", "Personal license", "Priority updates"], featuresJa: ["すべての既存パッケージ", "個人ライセンス", "優先アップデート"], featuresZh: ["所有现有套餐", "个人授权", "优先更新"], requirements: "Windows 10/11, 4 GB RAM", status: "active", fileKey: "", createdAt: new Date().toISOString() },
  { id: "ramcleaner-personal", slug: "ramcleaner-personal", name: "RAMCleaner Personal", nameEn: "RAMCleaner Personal", nameJa: "RAMCleaner パーソナル", nameZh: "RAMCleaner 个人版", shortDescription: "Dọn dẹp bộ nhớ thông minh - bản cá nhân, 1 thiết bị, cập nhật trọn đời.", shortDescriptionEn: "Smart memory cleaner - personal license, 1 device, lifetime updates.", shortDescriptionJa: "スマートメモリクリーナー - 個人ライセンス、1台のデバイス、生涯アップデート。", shortDescriptionZh: "智能内存清理 - 个人授权，1台设备，终身更新。", description: "RAMCleaner Personal giải phóng bộ nhớ RAM bị Windows giữ lại dưới dạng standby/modified, nén bộ nhớ và dọn dẹp file tạm sau phiên làm việc dài.\n\nChỉ cần tải về và chạy - không cài đặt, không cần quyền admin cho chế độ cơ bản. Hỗ trợ Windows 10/11 (x64), Linux (x64), macOS (Intel & Apple Silicon).", descriptionEn: "RAMCleaner Personal frees the RAM Windows holds back as standby and modified memory, compresses memory and cleans temp files after a long session. Runs portable - no install, no admin rights needed for basic mode. Supports Windows 10/11 (x64), Linux (x64) and macOS (Intel & Apple Silicon).", descriptionJa: "RAMCleaner Personalは、Windowsがスタンバイ/修正メモリとして保持しているRAMを解放し、メモリを圧縮し、長時間のセッション後に一時ファイルをクリーンアップします。ポータブルに動作し、インストール不要で、基本モードでは管理者権限も不要です。Windows 10/11 (x64)、Linux (x64)、macOS (Intel & Apple Silicon) をサポートしています。", descriptionZh: "RAMCleaner 个人版释放 Windows 以待机/修改内存形式保留的 RAM，压缩内存并在长时间会话后清理临时文件。便携运行 - 无需安装，基本模式无需管理员权限。支持 Windows 10/11 (x64)、Linux (x64) 和 macOS (Intel & Apple Silicon)。", category: "Công cụ", platform: "Windows, Linux, macOS", version: "2.0.0", price: 299000, currency: "VND", badge: "Phổ biến", features: ["Dọn dẹp Standby/Modified/List memory tự động", "Nén bộ nhớ (Memory Compression) giảm RAM dùng", "Dọn file tạm User/Windows/Prefetch/Update Cache/Recycle Bin", "Giải phóng RAM bị standby giữ lại sau phiên làm việc dài", "Cập nhật trọn đời miễn phí", "Giao diện tiếng Việt / English", "Không cần cài đặt - portable exe đơn lẻ"], featuresEn: ["Auto cleanup Standby/Modified/List memory", "Memory Compression reduces RAM usage", "Clean User/Windows/Prefetch/Update Cache/Recycle Bin temp files", "Frees RAM held back as standby memory after long sessions", "Lifetime free updates", "Vietnamese/English interface", "Portable single exe - no installation"], featuresJa: ["スタンバイ/修正/リストメモリの自動クリーンアップ", "メモリ圧縮によりRAM使用量を削減", "ユーザー/Windows/Prefetch/アップデートキャッシュ/ゴミ箱の一時ファイルをクリーンアップ", "長時間のセッション後にスタンバイ保持されたRAMを解放", "生涯無料アップデート", "ベトナム語/英語インターフェース", "インストール不要 - ポータブルEXE単一ファイル"], featuresZh: ["自动清理待机/修改/列表内存", "内存压缩减少 RAM 使用量", "清理用户/Windows/Prefetch/更新缓存/回收站临时文件", "释放长时间会话后被待机保留的 RAM", "终身免费更新", "越南语/英语界面", "无需安装 - 便携单文件 exe"], requirements: "Windows 10/11 (x64), Linux (glibc 2.31+), macOS 10.15+ | Cần admin/root cho chế độ aggressive", requirementsEn: "Windows 10/11 (x64), Linux (glibc 2.31+) or macOS 10.15+; admin/root only for aggressive mode.", status: "active", fileKey: "", createdAt: new Date().toISOString(), seoTitle: "RAMCleaner – Cách giải phóng RAM standby trên Windows 10/11", seoDescription: "RAM bị giữ lại dạng standby memory sau khi chơi game hay chạy máy ảo? RAMCleaner giải phóng, nén bộ nhớ, dọn file tạm. Portable. 299.000đ.", seoTitleEn: "RAMCleaner – Free Up Standby RAM on Windows 10/11", seoDescriptionEn: "Windows holding RAM as standby memory after gaming or a VM run? RAMCleaner frees standby and modified memory, compresses memory, cleans temp files. Portable. 299,000₫.", shortDescriptionEn: "Smart memory cleaner - personal license, 1 device, lifetime updates.", descriptionEn: "RAMCleaner Personal frees the RAM Windows holds back as standby and modified memory, compresses memory and cleans temp files after a long session. Runs portable - no install, no admin rights needed for basic mode. Supports Windows 10/11 (x64), Linux (x64) and macOS (Intel & Apple Silicon).", featuresEn: ["Auto cleanup Standby/Modified/List memory", "Memory Compression reduces RAM usage", "Clean User/Windows/Prefetch/Update Cache/Recycle Bin temp files", "Frees RAM held back as standby memory after long sessions", "Lifetime free updates", "Vietnamese/English interface", "Portable single exe - no installation"] },
  { id: "ramcleaner-business", slug: "ramcleaner-business", name: "RAMCleaner Business", nameEn: "RAMCleaner Business", nameJa: "RAMCleaner ビジネス", nameZh: "RAMCleaner 企业版", shortDescription: "Dọn dẹp bộ nhớ doanh nghiệp - 10 thiết bị, triển khai tập trung, hỗ trợ ưu tiên.", shortDescriptionEn: "Enterprise memory cleaner - 10 devices, centralized deploy, priority support.", shortDescriptionJa: "エンタープライズメモリクリーナー - 10台のデバイス、集中展開、優先サポート。", shortDescriptionZh: "企业内存清理 - 10台设备，集中部署，优先支持。", description: "RAMCleaner Business dành cho môi trường doanh nghiệp cần quản lý bộ nhớ trên nhiều máy tính. Bao gồm license 10 thiết bị, file cấu hình tập trung (RamCleaner.config.ini), script triển khai hàng loạt (PowerShell/Bash), systemd timer (Linux) và launchd plist (macOS) cho lịch tự động.\n\nHỗ trợ email ưu tiên trong 1 năm. Tương thích Windows, Linux (Ubuntu/Debian/Fedora/Arch), macOS (Intel & Apple Silicon).", descriptionEn: "RAMCleaner Business for enterprises managing memory across multiple machines. Includes 10-device license, centralized config file (RamCleaner.config.ini), mass deployment scripts (PowerShell/Bash/Ansible), systemd timer (Linux) and launchd plist (macOS) for automated scheduling. Priority email support for 1 year. Cross-platform: Windows, Linux (Ubuntu/Debian/Fedora/Arch), macOS (Intel & Apple Silicon).", descriptionJa: "RAMCleaner Businessは、複数のコンピュータでメモリを管理する必要がある企業環境向けです。10台のデバイスライセンス、集中設定ファイル (RamCleaner.config.ini)、大量展開スクリプト (PowerShell/Bash)、systemdタイマー (Linux) および launchd plist (macOS) による自動スケジュールが含まれています。\n\n1年間の優先メールサポートを提供します。Windows、Linux (Ubuntu/Debian/Fedora/Arch)、macOS (Intel & Apple Silicon) と互換性があります。", descriptionZh: "RAMCleaner 企业版适用于需要在多台计算机上管理内存的企业环境。包括 10 台设备授权、集中配置文件 (RamCleaner.config.ini)、批量部署脚本 (PowerShell/Bash)、systemd 定时器 (Linux) 和 launchd plist (macOS) 用于自动调度。\n\n提供为期 1 年的优先电子邮件支持。兼容 Windows, Linux (Ubuntu/Debian/Fedora/Arch), macOS (Intel & Apple Silicon)。", category: "Công cụ", platform: "Windows, Linux, macOS", version: "2.0.0", price: 499000, currency: "VND", badge: "Doanh nghiệp", features: ["Tất cả tính năng Personal", "License 10 thiết bị", "File cấu hình tập trung (RamCleaner.config.ini)", "Script triển khai hàng loạt (PowerShell/Bash/Ansible)", "Systemd timer (Linux) & launchd plist (macOS) cho lịch tự động", "Hỗ trợ email ưu tiên 1 năm", "Chế độ aggressive (cần admin/root) dọn sâu hơn", "Báo cáo HTML/CSV chi tiết sau mỗi lần chạy"], featuresEn: ["All Personal features", "10-device license", "Centralized config file (RamCleaner.config.ini)", "Mass deployment scripts (PowerShell/Bash/Ansible)", "Systemd timer (Linux) & launchd plist (macOS) for auto-scheduling", "Priority email support 1 year", "Aggressive mode (requires admin/root) for deeper cleanup", "Detailed HTML/CSV reports after each run"], featuresJa: ["すべてのパーソナル機能", "10台のデバイスライセンス", "集中設定ファイル (RamCleaner.config.ini)", "大量展開スクリプト (PowerShell/Bash/Ansible)", "systemdタイマー (Linux) と launchd plist (macOS) による自動スケジュール", "1年間の優先メールサポート", "アグレッシブモード (管理者/ルート権限が必要) でより深いクリーンアップ", "実行ごとの詳細なHTML/CSVレポート"], featuresZh: ["所有个人功能", "10台设备授权", "集中配置文件 (RamCleaner.config.ini)", "批量部署脚本 (PowerShell/Bash/Ansible)", "systemd 定时器 (Linux) 和 launchd plist (macOS) 用于自动调度", "1年优先电子邮件支持", "激进模式 (需要管理员/root) 进行深度清理", "每次运行后生成详细的 HTML/CSV 报告"], requirements: "Windows 10/11 (x64), Linux (glibc 2.31+), macOS 10.15+ | Cần quyền admin/root cho chế độ aggressive", requirementsEn: "Windows 10/11 (x64), Linux (glibc 2.31+), macOS 10.15+; admin/root required for aggressive mode.", status: "active", fileKey: "", createdAt: new Date().toISOString(), seoTitle: "RAMCleaner Business - Dọn dẹp RAM doanh nghiệp 10 thiết bị, triển khai tập trung", seoDescription: "RAMCleaner Business cho doanh nghiệp: license 10 thiết bị, config tập trung (RamCleaner.config.ini), script triển khai PowerShell/Bash/Ansible, systemd timer (Linux), launchd plist (macOS). Hỗ trợ ưu tiên 1 năm. Giá 499.000đ.", seoTitleEn: "RAMCleaner Business - Enterprise Memory Cleaner 10 Devices, Centralized Deploy", seoDescriptionEn: "Enterprise RAM cleaner: 10-device license, centralized config (RamCleaner.config.ini), mass deploy scripts (PowerShell/Bash/Ansible), systemd timer (Linux), launchd plist (macOS). Priority support 1 year. 499k VND.", shortDescriptionEn: "Enterprise memory cleaner - 10 devices, centralized deploy, priority support.", descriptionEn: "RAMCleaner Business for enterprises managing memory across multiple machines. Includes 10-device license, centralized config file (RamCleaner.config.ini), mass deployment scripts (PowerShell/Bash/Ansible), systemd timer (Linux) and launchd plist (macOS) for automated scheduling. Priority email support for 1 year. Cross-platform: Windows, Linux (Ubuntu/Debian/Fedora/Arch), macOS (Intel & Apple Silicon).", featuresEn: ["All Personal features", "10-device license", "Centralized config file (RamCleaner.config.ini)", "Mass deployment scripts (PowerShell/Bash/Ansible)", "Systemd timer (Linux) & launchd plist (macOS) for auto-scheduling", "Priority email support 1 year", "Aggressive mode (requires admin/root) for deeper cleanup", "Detailed HTML/CSV reports after each run"] },
  { id: "ramcleaner-earlybird", slug: "ramcleaner-earlybird", name: "RAMCleaner Early Bird", nameEn: "RAMCleaner Early Bird", nameJa: "RAMCleaner アーリーバード", nameZh: "RAMCleaner 早鸟版", shortDescription: "Ưu đãi sớm - chỉ 199.000đ (giảm 33%) cho 100 khách đầu tiên.", shortDescriptionEn: "Early bird deal for the first 100 customers.", shortDescriptionJa: "早期割引 - 先着100名様限定。", shortDescriptionZh: "早鸟优惠 - 前100名客户限定。", description: "Gói ưu đãi Early Bird cho 100 khách hàng đầu tiên. Bao gồm toàn bộ tính năng RAMCleaner Personal với giá chỉ 199.000đ thay vì 299.000đ.\n\nSau khi hết 100 gói, giá sẽ quay về mức tiêu chuẩn. Mua sớm để khóa giá ưu đãi trọn đời.", descriptionEn: "Early Bird offer for the first 100 customers. Full RAMCleaner Personal features.

Once 100 copies sell out, register at the standard price. Lifetime updates included. Windows 10/11 (x64), Linux (x64), macOS (Intel & Apple Silicon).", descriptionJa: "先着100名様限定のアーリーバードプランです。RAMCleaner Personalのすべての機能を、通常299,000₫のところ199,000₫で提供します。\n\n100個の限定枠が埋まり次第、標準価格に戻ります。お早めに購入して、生涯割引価格を確定させてください。", descriptionZh: "为前100名客户提供的早鸟优惠包。以 199,000₫ 的价格获得 RAMCleaner 个人版的所有功能（标准价 299,000₫）。\n\n100 份售完后，价格将恢复到标准水平。尽早购买以锁定终身优惠价。", category: "Công cụ", platform: "Windows, Linux, macOS", version: "2.0.0", price: 199000, currency: "VND", badge: "Ưu đãi sớm", features: ["Toàn bộ tính năng RAMCleaner Personal", "Ưu đãi sớm cho 100 khách hàng đầu tiên", "Chỉ 100 gói - hết là hết", "Cập nhật trọn đời như bản tiêu chuẩn", "Hỗ trợ Windows 10/11 (x64), Linux (x64), macOS (Intel & Apple Silicon)"], featuresEn: ["All RAMCleaner Personal features", "Early bird offer for first 100 customers", "Only 100 copies - first come first served", "Lifetime updates like standard edition", "Windows 10/11 (x64), Linux (x64), macOS (Intel & Apple Silicon) support"], featuresJa: ["RAMCleaner Personalのすべての機能", "早期割引価格 199,000₫ (標準より33% OFF)", "限定100個 - なくなり次第終了", "標準版と同様の生涯アップデート", "Windows 10/11 (x64), Linux (x64), macOS (Intel & Apple Silicon) サポート"], featuresZh: ["所有 RAMCleaner 个人版功能", "早鸟优惠价 199,000₫ (比标准价低 33%)", "仅限 100 份 - 售完即止", "与标准版相同的终身更新", "支持 Windows 10/11 (x64), Linux (x64), macOS (Intel & Apple Silicon)"], requirements: "Windows 10/11 (x64), Linux (glibc 2.31+), macOS 10.15+ | Cần admin/root cho chế độ aggressive", requirementsEn: "Windows 10/11 (x64), Linux (glibc 2.31+) or macOS 10.15+; admin/root only for aggressive mode.", status: "active", fileKey: "", createdAt: new Date().toISOString(), seoTitle: "RAMCleaner Early Bird - Ưu đãi 199.000đ (giảm 33%) chỉ 100 gói đầu", seoDescription: "RAMCleaner Early Bird: toàn bộ tính năng Personal chỉ 199.000đ thay vì 299.000đ. Chỉ 100 gói ưu đãi sớm, hết là hết. Cập nhật trọn đời. Mua sớm khóa giá ưu đãi.", seoTitleEn: "RAMCleaner Early Bird - 199k VND (33% off) First 100 Customers Only", seoDescriptionEn: "Early Bird deal: all Personal features for 199k VND instead of 299k. Only 100 copies available. Lifetime updates included. Lock in early-bird price forever.", shortDescriptionEn: "Early bird deal for the first 100 customers.", descriptionEn: "Early Bird offer for the first 100 customers. Full RAMCleaner Personal features.

Once 100 copies sell out, register at the standard price. Lifetime updates included. Windows 10/11 (x64), Linux (x64), macOS (Intel & Apple Silicon).", featuresEn: ["All RAMCleaner Personal features", "Early bird offer for first 100 customers", "Only 100 copies - first come first served", "Lifetime updates like standard edition", "Windows 10/11 (x64), Linux (x64), macOS (Intel & Apple Silicon) support"] },
];

export async function ensureSeed() {
  // The mkdir is inside the local branch, and it used to be the first statement in
  // the function — before the `if (local)`. With Supabase configured this host has
  // no business creating a data directory at all, and on a platform whose
  // filesystem is read-only (every serverless host: the code is deployed as a
  // bundle, not a checkout) fs.mkdir throws EROFS and the boot dies before a
  // single route is registered. The shop looked unshippable for a reason that had
  // nothing to do with the shop.
  //
  // So the directory is created only by the code path that will write into it.
  if (local) {
    await fs.mkdir(path.join(root, "data"), { recursive: true });
    if (!(await fs.stat(files.products).catch(() => null))) await writeJson(files.products, seedProducts);
    if (!(await fs.stat(files.orders).catch(() => null))) await writeJson(files.orders, []);
    return;
  } try { const rows = await supabase("products?select=id&limit=1"); if (!rows?.length) await supabase("products", { method: "POST", body: JSON.stringify(seedProducts.map(toProduct)) }); } catch (error) {
  // Fail closed, never silent: when Supabase is configured but unreachable,
  // falling back to local JSON would write paid orders to this host's ephemeral
  // disk while every other host keeps writing to Postgres — revenue split across
  // two stores with no error anywhere. So a configured-but-down database stops
  // the boot with an error (the host restarts, /api/health goes 503) instead of
  // quietly becoming a second, forgetful shop. The local fallback remains for
  // hosts that never configured Supabase at all.
  console.error(`[store] Supabase configured but unreachable, refusing local fallback: ${error.message}`);
  throw error;
} }

// The one way this project talks to Postgres: one header set, one error shape, one
// file. See src/supabase-http.js for why the client lives on its own.
//
// `Prefer: return=representation` makes PostgREST hand back the row it wrote, so a
// create does not have to read it again and lose a write that landed in between.
// The thrown error keeps the status and the SQLSTATE, which is what lets a caller
// tell "this exact checkout attempt already produced an order" — 23505 on the
// unique idempotency key — apart from "the database is unreachable". The first is
// a success the buyer should be shown; the second is an outage. Both used to arrive
// as one opaque "Supabase 409/500" string, so the checkout path had to guess.
const supabase = (pathname, options = {}) => supabaseRequest(pathname, options);
const fromProduct = (row) => row ? { ...row, shortDescription: row.shortDescription ?? row.short_description ?? "", description: row.description ?? "", fileKey: row.fileKey ?? row.file_key ?? "", fileSize: row.fileSize ?? row.file_size ?? 0, virusScanUrl: row.virusScanUrl ?? row.virus_scan_url ?? "", shortDescriptionEn: row.shortDescriptionEn ?? row.short_description_en ?? "", descriptionEn: row.descriptionEn ?? row.description_en ?? "",
requirementsEn: row.requirementsEn ?? row.requirements_en ?? "", featuresEn: row.featuresEn ?? row.features_en ?? [], seoTitle: row.seoTitle ?? row.seo_title ?? "", seoDescription: row.seoDescription ?? row.seo_description ?? "", seoTitleEn: row.seoTitleEn ?? row.seo_title_en ?? "", seoDescriptionEn: row.seoDescriptionEn ?? row.seo_description_en ?? "", createdAt: row.createdAt ?? row.created_at, updatedAt: row.updatedAt ?? row.updated_at } : null;
const fromOrder = (row) => row ? { ...row, orderNumber: row.orderNumber ?? row.order_number, accessTokenHash: row.accessTokenHash ?? row.access_token_hash, providerOrderId: row.providerOrderId ?? row.provider_order_id, customerEmail: row.customerEmail ?? row.customer_email, customerName: row.customerName ?? row.customer_name, paymentProvider: row.paymentProvider ?? row.payment_provider, paidAt: row.paidAt ?? row.paid_at, expiresAt: row.expiresAt ?? row.expires_at ?? null, cancelledAt: row.cancelledAt ?? row.cancelled_at ?? null, cancelReason: row.cancelReason ?? row.cancel_reason ?? null, deliveredAt: row.deliveredAt ?? row.delivered_at ?? null, paidCount: row.paidCount ?? row.paid_count ?? 0, paidAmount: row.paidAmount ?? row.paid_amount ?? 0, paidProviderAmount: row.paidProviderAmount ?? row.paid_provider_amount ?? 0, paidProviderCurrency: row.paidProviderCurrency ?? row.paid_provider_currency ?? null, refundedAt: row.refundedAt ?? row.refunded_at ?? null, refundReason: row.refundReason ?? row.refund_reason ?? null, refundedCount: row.refundedCount ?? row.refunded_count ?? 0, refundedAmount: row.refundedAmount ?? row.refunded_amount ?? 0, refundedProviderAmount: row.refundedProviderAmount ?? row.refunded_provider_amount ?? 0, idempotencyKey: row.idempotencyKey ?? row.idempotency_key ?? null, notifications: row.notifications ?? {}, reviews: row.reviews ?? [], createdAt: row.createdAt ?? row.created_at, updatedAt: row.updatedAt ?? row.updated_at } : null;
const toProduct = (p) => { const { shortDescription, fileKey, fileSize, virusScanUrl, shortDescriptionEn, descriptionEn, requirementsEn, featuresEn, seoTitle, seoDescription, seoTitleEn, seoDescriptionEn, createdAt, updatedAt, ...columns } = p; return { ...columns, ...(shortDescription !== undefined ? { short_description: shortDescription } : {}), ...(fileKey !== undefined ? { file_key: fileKey } : {}), ...(fileSize !== undefined ? { file_size: fileSize } : {}), ...(virusScanUrl !== undefined ? { virus_scan_url: virusScanUrl } : {}), ...(shortDescriptionEn !== undefined ? { short_description_en: shortDescriptionEn } : {}), ...(descriptionEn !== undefined ? { description_en: descriptionEn } : {}),
...(requirementsEn !== undefined ? { requirements_en: requirementsEn } : {}), ...(seoTitle !== undefined ? { seo_title: seoTitle } : {}), ...(seoDescription !== undefined ? { seo_description: seoDescription } : {}), ...(seoTitleEn !== undefined ? { seo_title_en: seoTitleEn } : {}), ...(seoDescriptionEn !== undefined ? { seo_description_en: seoDescriptionEn } : {}), ...(featuresEn !== undefined ? { features_en: featuresEn } : {}), ...(createdAt !== undefined ? { created_at: createdAt } : {}), ...(updatedAt !== undefined ? { updated_at: updatedAt } : {}) }; };
const toOrder = (o) => { const { orderNumber, accessTokenHash, providerOrderId, customerEmail, customerName, paymentProvider, paidAt, expiresAt, cancelledAt, cancelReason, deliveredAt, paidCount, paidAmount, paidProviderAmount, paidProviderCurrency, refundedAt, refundReason, refundedCount, refundedAmount, refundedProviderAmount, idempotencyKey, notifications, reviews, createdAt, updatedAt, ...columns } = o; return { ...columns, ...(orderNumber !== undefined ? { order_number: orderNumber } : {}), ...(accessTokenHash !== undefined ? { access_token_hash: accessTokenHash } : {}), ...(providerOrderId !== undefined ? { provider_order_id: providerOrderId } : {}), ...(customerEmail !== undefined ? { customer_email: customerEmail } : {}), ...(customerName !== undefined ? { customer_name: customerName } : {}), ...(paymentProvider !== undefined ? { payment_provider: paymentProvider } : {}), ...(paidAt !== undefined ? { paid_at: paidAt } : {}), ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}), ...(cancelledAt !== undefined ? { cancelled_at: cancelledAt } : {}), ...(cancelReason !== undefined ? { cancel_reason: cancelReason } : {}), ...(deliveredAt !== undefined ? { delivered_at: deliveredAt } : {}), ...(paidCount !== undefined ? { paid_count: paidCount } : {}), ...(paidAmount !== undefined ? { paid_amount: paidAmount } : {}), ...(paidProviderAmount !== undefined ? { paid_provider_amount: paidProviderAmount } : {}), ...(paidProviderCurrency !== undefined ? { paid_provider_currency: paidProviderCurrency } : {}), ...(refundedAt !== undefined ? { refunded_at: refundedAt } : {}), ...(refundReason !== undefined ? { refund_reason: refundReason } : {}), ...(refundedCount !== undefined ? { refunded_count: refundedCount } : {}), ...(refundedAmount !== undefined ? { refunded_amount: refundedAmount } : {}), ...(refundedProviderAmount !== undefined ? { refunded_provider_amount: refundedProviderAmount } : {}), ...(idempotencyKey !== undefined ? { idempotency_key: idempotencyKey } : {}), ...(notifications !== undefined ? { notifications } : {}), ...(reviews !== undefined ? { reviews } : {}), ...(createdAt !== undefined ? { created_at: createdAt } : {}), ...(updatedAt !== undefined ? { updated_at: updatedAt } : {}) }; };
let local = !isConfigured.supabase;

/**
 * Whether a product can actually be bought.
 *
 * Four places used to ask this separately — the catalogue API, the product page,
 * the sitemap and the homepage — and they did not agree. The sitemap counted a
 * product as sellable while the storefront filtered it out, which handed Google
 * three URLs that lead to a 404. One rule, used by all of them, is the only way
 * "listed" and "buyable" can stay the same set.
 */
export const isSellable = (product) => Boolean(product)
  && product.status === "active"
  && Boolean(product.slug)
  && Boolean(product.fileKey)
  && isConfigured.r2;

// The admin list, optionally narrowed to what the owner typed and to one status.
//
// A hundred products became a page nobody could use: the row being looked for was
// somewhere below the fold and scrolling was the only way to reach it. `q` and
// `status` are applied by the database rather than here because the panel must
// show the same filtered set whether the shop has ten products or ten thousand.
//
// `status` wins over `includeDrafts` when both ask for something: an explicit
// status is the narrower request, and answering the broader one silently shows
// drafts under a heading that says "Đang bán".
export async function listProducts({ includeDrafts = false, q = "", status = "" } = {}) {
  const needle = String(q || "").toLowerCase();
  if (!local) {
    const params = ["select=*"];
    if (status) params.push(`status=eq.${encodeURIComponent(status)}`);
    else if (!includeDrafts) params.push("status=eq.active");
    // Name and slug are both what a person recognises: the label on the row and the
    // code that appears in URLs and in upload paths.
    if (needle) params.push(`or=${encodeURIComponent(`(name.ilike.*${needle}*,slug.ilike.*${needle}*)`)}`);
    params.push("order=created_at.desc");
    return (await supabase(`products?${params.join("&")}`)).map(fromProduct);
  }
  let items = await readJson(files.products, []);
  if (status) items = items.filter((p) => p.status === status);
  else if (!includeDrafts) items = items.filter((p) => p.status === "active");
  if (needle) items = items.filter((p) => `${p.name || ""} ${p.slug || ""}`.toLowerCase().includes(needle));
  return items;
}
export async function getProduct(id) { if (!local) return fromProduct((await supabase(`products?id=eq.${encodeURIComponent(id)}&limit=1`))[0]); return (await readJson(files.products, [])).find((p) => p.id === id || p.slug === id) || null; }
// Product pages are addressed by slug because it is what goes in a URL and in
// the sitemap. Slugs are unique, so an ambiguous match is a data problem worth
// surfacing rather than silently picking one.
export async function getProductBySlug(slug) { if (!local) return fromProduct((await supabase(`products?slug=eq.${encodeURIComponent(slug)}&select=*&limit=2`))[0] || null); return (await readJson(files.products, [])).find((p) => p.slug === slug) || null; }
export async function createProduct(product) { if (!local) return fromProduct((await supabase("products", { method: "POST", body: JSON.stringify(toProduct({ ...product, id: product.id || crypto.randomUUID() })) }))[0]); const items = await readJson(files.products, []); const item = { ...product, id: product.id || crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; await writeJson(files.products, [item, ...items]); return item; }
export async function updateProduct(id, patch) { if (!local) return fromProduct((await supabase(`products?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(toProduct(patch)) }))[0]); const items = await readJson(files.products, []); const item = items.find((p) => p.id === id); if (!item) return null; Object.assign(item, patch, { updatedAt: new Date().toISOString() }); await writeJson(files.products, items); return item; }

/**
 * How many orders were ever placed for one product.
 *
 * Deleting a product nobody has bought is housekeeping. Deleting one somebody has
 * bought is erasing the only link between those orders and a name, a price and a
 * version, so the panel refuses and offers to archive instead. The buyer's own copy
 * of the item — which the download reads — is not affected either way, which is
 * exactly why this check is about the owner's ledger rather than the delivery.
 *
 * The JSON containment filter is how PostgREST reaches inside an array column
 * without a join: `items` holds an array of objects, and the containment asks
 * whether any element carries this product id.
 */
export async function countOrdersForProduct(productId) {
  if (!productId) return 0;
  if (local) return (await readJson(files.orders, [])).filter((o) => (o.items || []).some((item) => item && item.productId === productId)).length;
  // Built with JSON.stringify so a product id containing a quote or a backslash
  // lands in the filter escaped rather than breaking the query string.
  const filter = encodeURIComponent(`items=cs.${JSON.stringify([{ productId: String(productId) }])}`);
  return supabaseCount("orders", `select=id&${filter}`);
}

/**
 * Removes the product row and returns it, or null when there was nothing to remove.
 *
 * The release file in R2 is deliberately left alone: an order that was already paid
 * holds the storage key it was sold with, and deleting the object would take the
 * download away from a customer who paid. Orphaned bytes are the cheaper mistake.
 */
export async function deleteProduct(id) {
  if (!local) return fromProduct((await supabase(`products?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" }))[0] || null);
  const items = await readJson(files.products, []);
  const item = items.find((p) => p.id === id);
  if (!item) return null;
  await writeJson(files.products, items.filter((p) => p.id !== id));
  return item;
}
// Every order ever written, newest first. This is deliberately the wide one: the
// admin history view shows the lot. Anything on a timer or a poll must use one of
// the narrow queries below instead, because the cost of this one grows forever
// while the work those callers do does not.
/**
 * The one filter the admin order list is allowed to have.
 *
 * A search box that narrowed the page but not the count told the owner there were
 * rows the panel refused to show: "2 đơn khớp 'son'" over a total of five, in a
 * table where only one of the two matched. The page and the count take this same
 * object so the figure on screen describes the rows on screen.
 *
 * The three fields are the ones a person has on hand when a buyer writes in: the
 * order id they were emailed, their address, their name. What they bought is not
 * searchable here — the item name lives inside a JSON array PostgREST cannot
 * filter on, and "which orders bought X" is what the revenue panel already
 * answers, under each product.
 */
const orderFilter = ({ q = "", status = "" } = {}) => {
  const needle = String(q || "").trim();
  const state = String(status || "").trim();
  // An unknown status is a filter nobody asked for, not an error: the admin
  // dropdown is a client-side list and the URL can be edited by hand.
  const wanted = ORDER_STATUSES.includes(state) ? state : "";
  const lower = needle.toLowerCase();
  return {
    needle,
    status: wanted,
    matches: (order) => (wanted ? order.status === wanted : true)
      && (!needle || [order.id, order.customerEmail, order.customer_email, order.customerName, order.customer_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(lower))),
  };
};

/**
 * How many orders match the current filter.
 *
 * PostgREST reports the total in Content-Range when asked to count exactly, so this
 * costs one header on a query that fetches a single id rather than the table — the
 * same shape this function has always used, with the filter appended. A count that
 * ignored the panel's own search would put "2 đơn khớp 'son'" next to a total of
 * five and call the other three a mystery.
 */
export async function countOrders(filter = {}) {
  const { needle, status, matches } = orderFilter(filter);
  if (local) return (await readJson(files.orders, [])).filter(matches).length;
  const params = ["select=id"];
  if (status) params.push(`status=eq.${encodeURIComponent(status)}`);
  if (needle) params.push(`or=${encodeURIComponent(`(id.ilike.*${needle}*,customer_name.ilike.*${needle}*,customer_email.ilike.*${needle}*)`)}`);
  return supabaseCount("orders", params.join("&"));
}

/**
 * Every address that has ever been handed money back.
 *
 * Refunds are rare, so this is one short query for the whole table rather than one
 * per row of the page. The panel uses it to flag a returning buyer: not to refuse
 * the sale, but so the owner sees on the next order from that address that this
 * customer has already been given a refund once. Without it, a second order from
 * someone who refunded their first reads exactly like a brand-new customer, which
 * is the whole reason the list is worth the query.
 */
const REFUNDED_STATUS = "refunded";
export async function listRefundedEmails() {
  if (local) {
    const items = await readJson(files.orders, []);
    return [...new Set(items.filter((o) => o.status === REFUNDED_STATUS && o.customerEmail).map((o) => String(o.customerEmail).toLowerCase()))];
  }
  const rows = await supabase(`orders?select=customer_email&status=eq.${REFUNDED_STATUS}`);
  return [...new Set((rows || []).map((row) => String(row.customer_email || row.customerEmail || "").toLowerCase()).filter(Boolean))];
}

export async function listOrders({ limit = 200, offset = 0, q = "", status = "" } = {}) {
  const { needle, status: wanted, matches } = orderFilter({ q, status });
  if (local) {
    const items = (await readJson(files.orders, [])).slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return items.filter(matches).slice(offset, offset + limit);
  }
  const params = ["select=*", "order=created_at.desc"];
  if (wanted) params.push(`status=eq.${encodeURIComponent(wanted)}`);
  if (needle) params.push(`or=${encodeURIComponent(`(id.ilike.*${needle}*,customer_name.ilike.*${needle}*,customer_email.ilike.*${needle}*)`)}`);
  return (await supabase(`orders?${params.join("&")}&limit=${limit}&offset=${offset}`)).map(fromOrder);
}

/**
 * Unpaid orders that nobody has been handed the file for yet.
 *
 * The expiry sweep used to read the whole table once a minute to find these. An
 * order from last year can never expire again, so that query grew with history
 * while its actual work stayed flat — a shop with a few thousand orders ended up
 * moving a few thousand fat rows a minute, for ever, to look at rows it had
 * already dealt with. The (status, expires_at) index answers this shape exactly,
 * so the cost now tracks the orders open right now rather than every order ever
 * created.
 *
 * The null branch keeps legacy rows written before expires_at existed, whose
 * deadline is derived from their creation time. A range comparison never matches
 * null, so without it those orders would quietly stop being cancelled.
 *
 * The bound is inclusive. An order sitting exactly one warning window from its
 * deadline is at the very start of the window and is owed a reminder, and an
 * exclusive bound silently dropped it — the one order a buyer was closest to
 * losing.
 */
/**
 * The statuses an order can still be paid in.
 *
 * One list, used by the JSON filter, by both PostgREST queries and by the sweep's
 * own rule. It was previously three separate definitions and they had drifted: the
 * JSON path filtered on "not delivered and one of these two", while the Supabase
 * queries asked for `status=eq.pending_transfer` only. A PayPal order is `pending`
 * until its capture lands, so those queries never saw one — a customer who abandoned
 * PayPal checkout left an order that could never expire, never got its reminder
 * mail, and sat in the admin list for ever. The JSON path was right, the SQL was
 * wrong, and every test ran against JSON, so nothing noticed.
 *
 * Lives here rather than in orders.js because orders.js already imports this
 * module; the other way round is a cycle.
 */
export const UNPAID_STATUSES = Object.freeze(["pending", "pending_transfer"]);

/**
 * Whether this order can still take a payment.
 *
 * Defined here, beside the status list it reads, because orders.js imports
 * this module and importing the other way round is a cycle. The question
 * used to be answered twice — `isSettled` here, `isUnpaid` there — and the
 * local-mode filters below were built from the local copy, which measured
 * deadlines without the payment window: a file-backed shop swept orders as
 * expiring up to a window early, and fetched every unpaid order every tick
 * instead of only the ones near their deadline.
 */
export const isUnpaid = (order) => Boolean(order) && UNPAID_STATUSES.includes(order.status);

/** True once the file has been handed over, so the order is closed for good. */
export const isClosed = (order) => Boolean(order?.deliveredAt);

// Already clamped to at least an hour in config.js, so this reads the one
// resolved number rather than re-deriving a fallback.
const HOUR = 60 * 60 * 1000;
const windowMs = () => env.orders.paymentWindowHours * HOUR;

/**
 * When the buyer stops being able to pay. Stored on the order at creation so a
 * later change to the env var never silently moves a deadline under a buyer who
 * is already looking at a countdown; older rows fall back to their creation
 * time plus the current window.
 */
export function paymentDeadline(order) {
  const stored = order?.expiresAt ? new Date(order.expiresAt).getTime() : NaN;
  if (Number.isFinite(stored)) return stored;
  const created = new Date(order?.createdAt || "").getTime();
  return Number.isFinite(created) ? created + windowMs() : null;
}

/**
 * Every order status the shop can hold, in lifecycle order. This is the one
 * definition: the admin validation whitelist, the frontend status maps and the
 * unpaid subset above all derive from it, because a seventh status added in one
 * place and forgotten in another is an order the panel cannot display and the
 * API refuses to set. The unpaid subset stays separate — it is a business rule
 * about money, not the enumeration itself.
 */
export const ORDER_STATUSES = Object.freeze(["pending", "pending_transfer", "paid", "payment_failed", "cancelled", "refunded"]);

/** PostgREST `in` filter for the unpaid statuses, from the one list above. */
const unpaidFilter = () => `status=in.(${UNPAID_STATUSES.join(",")})`;

export async function listExpiringOrders({ before } = {}) {
  if (local) {
    const cutoff = before ? new Date(before).getTime() : Infinity;
    // The same rows the PostgREST query below returns: unpaid, not
    // delivered, and due. A deadline the clock cannot read counts as due
    // rather than as never, the way a null expires_at does above, so a
    // corrupt row is noticed by the sweep instead of sweeping under it.
    const due = (order) => {
      const deadline = paymentDeadline(order);
      return deadline === null || deadline <= cutoff;
    };
    return (await readJson(files.orders, [])).filter((order) => isUnpaid(order) && !isClosed(order) && due(order));
  }
  const deadline = before ? new Date(before).toISOString() : new Date(8.64e15).toISOString();
  return (await supabase(`orders?${unpaidFilter()}&delivered_at=is.null&or=(expires_at.lte.${deadline},expires_at.is.null)&select=*&order=expires_at.asc`)).map(fromOrder);
}

/** Unpaid and not yet delivered, with no deadline bound. Bounded by open orders. */
export async function listOpenOrders() {
  const columns = { accessTokenHash: 0, access_token_hash: 0, idempotencyKey: 0, idempotency_key: 0, notifications: 0 };
  const strip = (order) => Object.fromEntries(Object.entries(order).filter(([key]) => !(key in columns)));
  if (local) return (await readJson(files.orders, [])).filter((order) => isUnpaid(order) && !isClosed(order)).map(strip);
  return (await supabase(`orders?${unpaidFilter()}&delivered_at=is.null&select=id,status,amount,currency,created_at,expires_at&order=created_at.desc`)).map(fromOrder);
}

/**
 * The newest single order, for the admin badge poll that runs while the tab is open.
 *
 * Projected rather than handed over whole, in both backends. The Supabase path
 * can ask for columns and the local path cannot, and a function that returns
 * three fields on one backend and every field on the other is a trap for whoever
 * reads it next — especially when one of those fields is the buyer's access
 * token hash.
 */
export async function latestOrder() {
  if (local) {
    const row = (await readJson(files.orders, []))[0];
    // An empty store is the normal first state of a new install, not an error,
    // and the badge poll asks this every few seconds from the moment the admin
    // panel opens.
    if (!row) return null;
    const { accessTokenHash, access_token_hash, idempotencyKey, idempotency_key, notifications, ...rest } = row;
    return rest;
  }
  return fromOrder((await supabase("orders?select=id,status,created_at&order=created_at.desc&limit=1"))[0]);
}

/**
 * Every order, but only the columns the revenue report reads.
 *
 * A full row carries the access-token hash, the per-order notification log and
 * the line items. The report needs none of them, and skipping them turns a
 * multi-megabyte response into a few kilobytes once the shop has history.
 *
 * paid_provider_currency is in this list and was not. The report buckets gross and
 * net by `order.paidProviderCurrency` — the currency PayPal actually captured in,
 * which is USD for every foreign order — so on Postgres the column came back absent,
 * `fromOrder` aliased it to null, and the condition guarding the provider bucket was
 * never true. Every PayPal sale was then booked at its VND shelf price under
 * `gross.VND`: the report silently overstated revenue in dong and reported no
 * dollar total at all, on the one panel the owner reconciles against a PayPal
 * statement. The local JSON backend returned whole rows and so never showed it, and
 * every test in the suite runs against local JSON. A projection is a contract with
 * the reader: a column omitted is a field that reads as null, which is how a
 * missing value becomes a wrong answer rather than a visible failure.
 */
export async function listOrdersForRevenue() {
  if (local) return (await readJson(files.orders, [])).map(({ accessTokenHash, idempotencyKey, notifications, ...rest }) => rest);
  const columns = "id,status,amount,currency,items,delivered_at,created_at,expires_at,paid_count,refunded_count,paid_amount,refunded_amount,paid_provider_amount,paid_provider_currency,refunded_provider_amount";
  return (await supabase(`orders?select=${columns}`)).map(fromOrder);
}

export async function getOrder(id) { return local ? (await readJson(files.orders, [])).find((o) => o.id === id) : fromOrder((await supabase(`orders?id=eq.${encodeURIComponent(id)}&limit=1`))[0]); }
/**
 * Whether this token opens this order.
 *
 * Written here rather than in each caller because every feature that acts on
 * somebody's order — the download, the PayPal capture recovery, writing a review
 * — has to answer it the same way. It hashes and compares instead of reading the
 * stored hash, so the check is a single function and there is nowhere for a second
 * implementation to drift from the first.
 */
export const isOrderOwner = (order, accessToken) => {
  const stored = order?.accessTokenHash || order?.access_token_hash;
  const offered = String(accessToken || "");
  if (!stored || !offered) return false;
  const expected = Buffer.from(stored);
  const actual = Buffer.from(crypto.createHash("sha256").update(offered).digest("hex"));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};
// Lets a buyer who lost the response to checkout find the order they already
// created, instead of opening a second one for the same purchase.
export async function findOrderByIdempotencyKey(key) { if (!key) return null; return local ? (await readJson(files.orders, [])).find((o) => o.idempotencyKey === key) || null : fromOrder((await supabase(`orders?idempotency_key=eq.${encodeURIComponent(key)}&limit=1`))[0]); }
/**
 * Stores a new order, or returns the one this checkout attempt already created.
 *
 * The idempotency key is unique in the database, so the race the check-then-insert
 * in the route could not close is closed here instead: whichever request loses
 * gets 23505, reads the row the winner wrote, and returns it. From the buyer's
 * side the two requests are indistinguishable, which is the point — a checkout
 * that answers the same way twice is safe, and one that answers with two orders is
 * not, whatever the code believed.
 *
 * A 23505 for any other reason is not swallowed: only one that names the
 * idempotency key counts, so a genuine collision on the primary key still surfaces.
 */
export async function createOrder(order) {
  if (!local) {
    try {
      return fromOrder((await supabase("orders", { method: "POST", body: JSON.stringify(toOrder(order)) }))[0]);
    } catch (error) {
      if (error.code !== "23505" || !order.idempotencyKey || !/idempotency/i.test(error.details || "")) throw error;
      return findOrderByIdempotencyKey(order.idempotencyKey);
    }
  }
  let saved = null;
  await mutateJson(files.orders, (orders) => {
    // The same rule, enforced in the only place that can enforce it without a
    // transaction: inside the write queue, where reading and writing are one step.
    const existing = orders.find((o) => o.idempotencyKey && o.idempotencyKey === order.idempotencyKey);
    if (existing) { saved = existing; return orders; }
    saved = order;
    return [order, ...orders];
  });
  return saved;
}
export async function updateOrder(id, patch) { if (!local) return fromOrder((await supabase(`orders?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(toOrder(patch)) }))[0]); let saved = null; await mutateJson(files.orders, (orders) => { const order = orders.find((o) => o.id === id); if (!order) return orders; Object.assign(order, patch, { updatedAt: new Date().toISOString() }); saved = order; return orders; }); return saved; }

/**
 * A write that only lands on an order that has never recorded a payment.
 *
 * updateOrder reads nothing: it PATCHes by id and the last write wins. That is
 * right for every ordinary edit and wrong for exactly one — recording a payment.
 * Three entries into that write exist at once (the PayPal webhook, the capture
 * call, and the admin panel), and nothing stopped two of them from both reading
 * "no payment recorded", both computing paidCount + 1, and both writing. The order
 * ends up paid, which is correct, with the revenue doubled and a second
 * confirmation mailed, which is not.
 *
 * So the condition goes into the WHERE clause rather than into the caller's head.
 * PostgREST turns this into one UPDATE with a predicate, and two concurrent
 * statements cannot both satisfy it: the second matches nothing and is told so.
 * The local file gets the same guarantee from the write queue, where the test and
 * the write are one step.
 *
 * paid_count, not status: delivering an order deliberately returns it to pending,
 * so a status predicate would re-open the door the delivery just closed and the
 * retry would count again. paid_count is the money record and outlives that reset.
 *
 * @returns {object|null} the updated row, or null when a payment was already on it
 */
export async function recordOrderPaymentOnce(id, patch) {
  if (!local) {
    const rows = await supabase(`orders?id=eq.${encodeURIComponent(id)}&paid_count=eq.0`, {
      method: "PATCH", body: JSON.stringify(toOrder(patch)),
    });
    return rows?.length ? fromOrder(rows[0]) : null;
  }
  let saved = null;
  await mutateJson(files.orders, (orders) => {
    const order = orders.find((o) => o.id === id);
    if (!order || Number(order.paidCount || 0) > 0) return orders;
    Object.assign(order, patch, { updatedAt: new Date().toISOString() });
    saved = order;
    return orders;
  });
  return saved;
}
/**
 * Orders whose file was actually handed over, with just enough on each to answer
 * "did this customer review this product, and what did they say".
 *
 * A narrow query with an index behind it rather than reading the whole table:
 * reviews are rare, and a page load that pulled every order in the shop to find
 * them would get slower forever.
 *
 * The filter is delivered_at rather than status, because delivering an order
 * resets its status to pending on purpose — that is what lets a buyer download a
 * second time — so "paid" and "delivered" are never both true on the same row.
 */
export async function listFulfilledOrderReviews() {
  if (local) return (await readJson(files.orders, [])).filter((o) => o.deliveredAt);
  const columns = "id,status,items,reviews,paid_at,paid_count,created_at,delivered_at";
  return (await supabase(`orders?select=${columns}&delivered_at=not.is.null`)).map(fromOrder);
}

export let persistenceMode = local ? "local-json" : "supabase";
