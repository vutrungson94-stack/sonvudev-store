// Bộ giới hạn tần suất dùng chung cho mọi route.
//
// Tách từ src/app.js để có một định nghĩa duy nhất: trước đây `attempts` Map và
// `tooMany()` nằm inline trong app.js, không test trực tiếp được và không tái
// dùng được. Hành vi giữ nguyên 100% để không làm hỏng các test 429 hiện có
// (lookup 10, checkout-ip 30, checkout-email 12 trên cửa sổ 15 phút).
//
// Giới hạn single-process được ghi rõ: Map sống trong RAM của 1 tiến trình.
// Với 1 instance (Render Free, VPS systemd hiện tại) đây là đúng và đủ. Khi
// chạy nhiều instance sau này, cần sticky-session hoặc store ngoài (Redis /
// Supabase) — lúc đó thay `createRateLimiter` bằng backend chung, các caller
// `tooMany*` không phải sửa vì đã đi qua module này.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_KEYS = 20000;

export function createRateLimiter({ windowMs = WINDOW_MS, maxKeys = MAX_KEYS } = {}) {
  const attempts = new Map();
  const tooMany = (key, limit) => {
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter((time) => now - time < windowMs);
    recent.push(now);
    attempts.set(key, recent);
    // Evicting the oldest key when the table is full, rather than clearing all of
    // it. Clearing meant that one caller spraying 20,001 distinct keys reset every
    // window in the shop at once — the limiter's whole answer to an attack on the
    // limiter being "give up". Dropping the oldest entry costs the memory it has
    // to cost and nothing else, and a flood now buys an attacker nothing.
    if (attempts.size > maxKeys) {
      const oldest = attempts.keys().next();
      if (!oldest.done) attempts.delete(oldest.value);
    }
    return recent.length > limit;
  };
  const reset = () => attempts.clear();
  const size = () => attempts.size;
  return { tooMany, reset, size, windowMs };
}

// Singleton dùng bởi app.js — cùng một cửa sổ cho mọi route trong process.
// Không export: không có file nào import nó, và app.js chỉ cần hai hàm bên dưới.
const limiter = createRateLimiter();
const tooMany = (key, limit) => limiter.tooMany(key, limit);
export const tooManyAttempts = (req) => tooMany(`ip:${req.ip || 'unknown'}`, 10);
// Admin routes are authenticated by a 192-bit token, so a limit here is not about
// guessing it — brute force over that key space is hopeless either way. It is about
// the cost of a wrong guess: an unauthenticated request must not be able to make
// the server read a table. Exported because src/app.js needs it and a single
// limiter for every route is the thing this module exists to provide.
export const adminThrottled = (req) => tooMany(`admin:${req.ip || 'unknown'}`, 30);
// The health probe is public — a monitor cannot hold an admin token — and it is
// the most expensive unauthenticated route in the shop: it reaches the database and
// the FX rate on every call, and /api/health is a name every scanner already has.
// Sixty a minute is far above any real monitor (Render, UptimeRobot and the
// keep-awake worker all poll every few minutes) and far below anything worth doing.
export const healthThrottled = (req) => tooMany(`health:${req.ip || 'unknown'}`, 60);
export function checkoutThrottled(req, email) {
  return tooMany(`checkout-ip:${req.ip || 'unknown'}`, 30)
    || (Boolean(email) && tooMany(`checkout-email:${email}`, 12));
}
