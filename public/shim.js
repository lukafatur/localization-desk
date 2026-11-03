// Standalone-runtime shim: gives the Localization Desk page the same window.claude.use(...)
// surface it had on claude.ai, backed by this app's own API instead of claude.ai capabilities.
(() => {
  "use strict";
  const KEY_LS = "ldeskAppKey";
  const getKey = () => { try { return localStorage.getItem(KEY_LS) || ""; } catch { return ""; } };
  const setKey = (v) => { try { localStorage.setItem(KEY_LS, v); } catch {} };

  const err = (code, message) => Object.assign(new Error(message || code), { code });

  async function api(path, body, method) {
    const res = await fetch(path, {
      method: method || (body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", "X-App-Key": encodeURIComponent(getKey()) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (res.status === 401 && data?.error?.code === "bad_key") { askPassword(); throw err("not_granted", "Sign in with the app password first."); }
    if (!res.ok) throw err(data?.error?.code || "tool_error", data?.error?.message || `Request failed (${res.status})`);
    return data;
  }

  // ---------- password + Canva-connect chrome ----------
  let bar;
  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement("div");
    bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;display:none;justify-content:center;gap:12px;align-items:center;padding:10px 16px;background:#1a2130;color:#fff;font:14px system-ui;box-shadow:0 -2px 12px rgba(0,0,0,.25)";
    document.body.appendChild(bar);
    return bar;
  }
  function showBar(html) { const b = ensureBar(); b.innerHTML = html; b.style.display = "flex"; }
  function hideBar() { if (bar) bar.style.display = "none"; }

  let asking = false;
  function askPassword() {
    if (asking) return;
    asking = true;
    showBar(`<span>App password:</span><input id="ldKey" type="password" autocomplete="current-password" style="padding:6px 10px;border-radius:6px;border:0;min-width:180px;color:#111;background:#fff;caret-color:#111;font:14px system-ui">
      <button id="ldGo" style="padding:6px 14px;border-radius:6px;border:0;background:#8ea4ff;color:#0f1422;font-weight:600;cursor:pointer">Enter</button>
      <span id="ldMsg" style="opacity:.8"></span>`);
    const go = async () => {
      setKey(document.getElementById("ldKey").value.trim());
      asking = false;
      try { await api("/api/me"); hideBar(); location.reload(); }
      catch (e) {
        asking = true;
        document.getElementById("ldMsg").textContent =
          e.code === "not_granted" ? "Wrong password." : "Server error (not the password): " + (e.message || e.code);
      }
    };
    setTimeout(() => document.getElementById("ldKey")?.focus(), 50);
    document.getElementById("ldGo").onclick = go;
    document.getElementById("ldKey").onkeydown = (e) => { if (e.key === "Enter") go(); };
  }

  let meInfo = null;
  async function boot() {
    try {
      meInfo = await api("/api/me");
      if (!meInfo.canva) {
        showBar(`<span>Canva isn't connected for you yet.</span>
          <a href="/api/auth/start?key=${encodeURIComponent(getKey())}" style="padding:6px 14px;border-radius:6px;background:#8ea4ff;color:#0f1422;font-weight:600;text-decoration:none">Connect Canva</a>
          <span style="opacity:.7">You'll sign in at canva.com and come straight back.</span>`);
      } else hideBar();
    } catch (e) { if (e.code !== "not_granted") console.warn(e); }
  }
  document.addEventListener("DOMContentLoaded", boot);

  // ---------- capabilities ----------
  const mcp = {
    async callTool(server, tool, input) {
      const { user_intent, ...rest } = input || {};
      return api("/api/mcp", { tool, input: { ...rest, user_intent } });
    },
    async listTools() { return api("/api/mcp-tools"); },
  };

  // db: polling snapshots over /api/db (5 s, plus an immediate refresh after any write)
  const subs = new Set();
  function snapDocs(docs) { return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) }; }
  async function refreshAll() { for (const s of [...subs]) s.run(); }
  const db = {
    collection(path) {
      let order = null, dirn = "asc";
      const q = {
        orderBy(f, d) { order = f; dirn = d || "asc"; return q; },
        onSnapshot(cb, onErr) {
          const sub = {
            async run() {
              try { const r = await api("/api/db", { op: "list", collection: path, orderBy: order, dir: dirn }); cb(snapDocs(r.docs)); }
              catch (e) { onErr && onErr(e); }
            },
          };
          subs.add(sub);
          sub.run();
          const t = setInterval(() => sub.run(), 5000);
          return () => { clearInterval(t); subs.delete(sub); };
        },
      };
      return q;
    },
    doc(path) {
      return {
        set: async (data) => { await api("/api/db", { op: "set", path, data }); refreshAll(); },
        update: async (data) => { await api("/api/db", { op: "update", path, data }); refreshAll(); },
        delete: async () => { await api("/api/db", { op: "delete", path }); refreshAll(); },
      };
    },
  };

  const blobToB64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ media_type: blob.type || "image/jpeg", data: String(r.result).split(",")[1] });
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

  const sample = Object.assign(
    async (input, opts = {}) => {
      const images = await Promise.all((opts.images || []).map(blobToB64));
      const r = await api("/api/translate", { input, images, modelTier: opts.modelTier });
      return { text: r.text, truncated: false };
    },
    {
      async json(input, opts = {}) {
        const images = await Promise.all((opts.images || []).map(blobToB64));
        const r = await api("/api/translate", { input, images, modelTier: opts.modelTier, json: true });
        return r.json;
      },
      async limits() {
        return { inputBytes: 4_000_000, images: { maxCount: 6, maxInputBytes: 5_000_000, mediaTypes: ["image/jpeg", "image/png", "image/webp"] } };
      },
    }
  );

  const user = {
    async id() { if (!meInfo) meInfo = await api("/api/me"); return meInfo.uid || null; },
    async me() { if (!meInfo) meInfo = await api("/api/me"); return { id: meInfo.uid, name: meInfo.name || "" }; },
    isOwner: () => true,
    canEdit: () => true,
    can: () => true,
    async profiles(ids) {
      try { const r = await api("/api/db", { op: "profiles", uids: ids }); return r.profiles || {}; }
      catch { return {}; }
    },
    async search() { return []; },
  };

  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: filename || "download" });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      return { status: "saved" };
    },
  };

  const caps = { mcp, db, sample, user, downloads };
  window.claude = { use: async (name) => caps[name] || null };
})();
