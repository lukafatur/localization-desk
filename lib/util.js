import crypto from "node:crypto";

export function readCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}

export function setCookie(res, name, value, { maxAge = 60 * 60 * 24 * 90, httpOnly = true } = {}) {
  const prev = res.getHeader("Set-Cookie");
  const cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure${httpOnly ? "; HttpOnly" : ""}`;
  res.setHeader("Set-Cookie", [...(Array.isArray(prev) ? prev : prev ? [prev] : []), cookie]);
}

// One shared password gates every endpoint, so strangers can't spend your Canva/Anthropic quota.
export function checkAppKey(req) {
  const want = (process.env.APP_PASSWORD || "").trim();
  if (!want) return true; // explicitly disabled
  let got = String(req.headers["x-app-key"] || req.query?.key || "");
  try { got = decodeURIComponent(got); } catch {}
  got = got.trim();
  const a = crypto.createHash("sha256").update(got, "utf8").digest();
  const b = crypto.createHash("sha256").update(want, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

export function deny(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

export async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
  }
  let raw = "";
  for await (const c of req) raw += c;
  return raw ? JSON.parse(raw) : {};
}

export const rid = (n = 16) => crypto.randomBytes(n).toString("hex");
export const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
