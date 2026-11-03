import { supa } from "./supa.js";

export const AUTH_URL = "https://www.canva.com/api/oauth/authorize";
export const TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";
export const MCP_URL = "https://api.canva.com/connect/v1/mcp";
export const SCOPES = [
  "design:meta:read",
  "design:content:read",
  "design:content:write",
  "folder:read",
  "folder:write",
  "asset:read",
  "brandtemplate:meta:read",
  "profile:read",
].join(" ");

const basic = () =>
  "Basic " + Buffer.from(`${process.env.CANVA_CLIENT_ID}:${process.env.CANVA_CLIENT_SECRET}`).toString("base64");

export async function exchangeCode(code, verifier, redirectUri) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basic(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  return data; // { access_token, refresh_token, expires_in, scope, token_type }
}

async function refreshGrant(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basic(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error("needs_reauth"); e.code = "needs_reauth"; throw e; }
  return data;
}

// Returns a valid access token for this browser session, refreshing (with rotation-safe swap) when needed.
export async function accessTokenFor(sid) {
  let s = await supa.getSession(sid);
  if (!s) { const e = new Error("No Canva session"); e.code = "needs_reauth"; throw e; }
  if (Date.now() < new Date(s.expires_at).getTime() - 120_000) return s.access;
  // Expired: refresh. Canva refresh tokens are single-use, so swap atomically; the loser re-reads.
  const old = s.refresh;
  try {
    const t = await refreshGrant(old);
    const ok = await supa.swapTokens(sid, old, {
      access: t.access_token,
      refresh: t.refresh_token,
      expires_at: new Date(Date.now() + (t.expires_in || 14400) * 1000).toISOString(),
    });
    if (ok) return t.access_token;
  } catch (e) {
    // Maybe a parallel request already rotated it — re-read before giving up.
    const s2 = await supa.getSession(sid);
    if (s2 && s2.refresh !== old && Date.now() < new Date(s2.expires_at).getTime() - 60_000) return s2.access;
    throw e;
  }
  const s3 = await supa.getSession(sid);
  if (s3 && Date.now() < new Date(s3.expires_at).getTime() - 60_000) return s3.access;
  const e = new Error("No Canva session"); e.code = "needs_reauth"; throw e;
}

// ---------- minimal MCP client (Streamable HTTP) ----------
// A serverless instance keeps its MCP session in memory; a fresh instance re-initializes.
const mcpSessions = new Map(); // tokenHash -> { id, at }

function parseMcpBody(text, contentType) {
  if ((contentType || "").includes("text/event-stream")) {
    // take the last data: line that parses as JSON-RPC
    let out = null;
    for (const line of text.split("\n")) {
      const m = line.match(/^data:\s*(.+)$/);
      if (m) { try { out = JSON.parse(m[1]); } catch {} }
    }
    return out;
  }
  try { return JSON.parse(text); } catch { return null; }
}

async function mcpPost(token, body, sessionId) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, sessionId: res.headers.get("mcp-session-id"), data: parseMcpBody(text, res.headers.get("content-type")), raw: text };
}

async function ensureMcpSession(token) {
  const key = token.slice(-24);
  const hit = mcpSessions.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.id;
  const init = await mcpPost(token, {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "localization-desk", version: "1.0.0" } },
  });
  if (init.status === 401) { const e = new Error("Canva rejected the token"); e.code = "needs_reauth"; throw e; }
  if (init.status >= 400 && !init.data) throw new Error(`MCP initialize failed (${init.status}): ${init.raw.slice(0, 300)}`);
  const id = init.sessionId || null;
  if (id) await mcpPost(token, { jsonrpc: "2.0", method: "notifications/initialized" }, id).catch(() => {});
  mcpSessions.set(key, { id, at: Date.now() });
  return id;
}

async function rpc(token, method, params) {
  const sid = await ensureMcpSession(token);
  let r = await mcpPost(token, { jsonrpc: "2.0", id: Date.now(), method, params }, sid);
  if (r.status === 404 || r.status === 400) {
    // stale session on a recycled instance — start over once
    mcpSessions.clear();
    const sid2 = await ensureMcpSession(token);
    r = await mcpPost(token, { jsonrpc: "2.0", id: Date.now(), method, params }, sid2);
  }
  if (r.status === 401) { const e = new Error("Canva rejected the token"); e.code = "needs_reauth"; throw e; }
  if (r.status === 429) { const e = new Error("Too many requests to Canva"); e.code = "rate_limited"; throw e; }
  if (!r.data) throw new Error(`MCP ${method} gave no answer (${r.status}): ${r.raw.slice(0, 200)}`);
  if (r.data.error) {
    const e = new Error(r.data.error.message || "MCP error");
    e.code = /not.?found|unknown/i.test(r.data.error.message || "") ? "unknown_tool" : "tool_error";
    e.rpc = r.data.error;
    throw e;
  }
  return r.data.result;
}

export async function mcpListTools(token) {
  const out = [];
  let cursor;
  do {
    const r = await rpc(token, "tools/list", cursor ? { cursor } : {});
    out.push(...(r.tools || []));
    cursor = r.nextCursor;
  } while (cursor && out.length < 500);
  return out;
}

// The page speaks the claude.ai connector's tool names. The public MCP server renamed a few.
// Unknown-tool failures fall through this alias list before giving up.
const ALIASES = {
  "read-design": ["get-design-content", "get-design"],
  "edit-design": ["perform-editing-operations"],
};

export async function mcpCallTool(token, tool, input) {
  const call = (name) => rpc(token, "tools/call", { name, arguments: input });
  try {
    return await call(tool);
  } catch (e) {
    if (e.code !== "unknown_tool" || !ALIASES[tool]) throw e;
    for (const alt of ALIASES[tool]) {
      try { return await call(alt); } catch (e2) { if (e2.code !== "unknown_tool") throw e2; }
    }
    // Still unknown: tell the caller what the server actually offers, so the adapter can be finished.
    let names = [];
    try { names = (await mcpListTools(token)).map((t) => t.name); } catch {}
    const err = new Error(`Canva's MCP server has no tool "${tool}". It offers: ${names.join(", ") || "(couldn't list)"}. Open /api/mcp-tools?full=1 and send the output to Claude to finish the adapter.`);
    err.code = "tool_error";
    throw err;
  }
}

// Normalize an MCP result into what the page expects ({ payload, content }).
export function toPagePayload(result) {
  const content = result?.content || [];
  let payload = result?.structuredContent;
  if (payload === undefined) {
    const texts = content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (texts) {
      const m = texts.match(/[{[][\s\S]*[}\]]/);
      if (m) { try { payload = JSON.parse(m[0]); } catch { payload = texts; } }
      else payload = texts;
    }
  }
  if (result?.isError) {
    const msg = content.filter((b) => b.type === "text").map((b) => b.text).join("\n") || "Canva reported a problem.";
    const e = new Error(msg);
    e.code = "tool_error";
    throw e;
  }
  return { payload: payload ?? {}, content };
}
