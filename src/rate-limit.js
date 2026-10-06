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
    if (attempts.size > maxKeys) attempts.clear();
    return recent.length > limit;
  };
  const reset = () => attempts.clear();
  const size = () => attempts.size;
  return { tooMany, reset, size, windowMs };
}

// Singleton dùng bởi app.js — cùng một cửa sổ cho mọi route trong process.
export const limiter = createRateLimiter();
export const tooMany = (key, limit) => limiter.tooMany(key, limit);
export const tooManyAttempts = (req) => tooMany(`ip:${req.ip || 'unknown'}`, 10);
export function checkoutThrottled(req, email) {
  return tooMany(`checkout-ip:${req.ip || 'unknown'}`, 30)
    || (Boolean(email) && tooMany(`checkout-email:${email}`, 12));
}
