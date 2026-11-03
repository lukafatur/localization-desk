// Thin Supabase REST helper (service key, backend only — never ship this key to the browser).
const URL_ = () => String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = () => process.env.SUPABASE_SERVICE_KEY || "";

async function rest(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${URL_()}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY(),
      Authorization: `Bearer ${KEY()}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "resolution=merge-duplicates,return=representation" : "return=representation",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

export const supa = {
  // documents (the page's shared storage)
  async listDocs(collection) {
    return rest(`kv_docs?collection=eq.${encodeURIComponent(collection)}&select=path,data`);
  },
  async setDoc(path, collection, data) {
    return rest("kv_docs", { method: "POST", body: { path, collection, data } });
  },
  async updateDoc(path, patchFn) {
    const rows = await rest(`kv_docs?path=eq.${encodeURIComponent(path)}&select=path,collection,data`);
    if (!rows.length) throw new Error("not_found");
    const next = { ...rows[0].data, ...patchFn };
    return rest(`kv_docs?path=eq.${encodeURIComponent(path)}`, { method: "PATCH", body: { data: next } });
  },
  async deleteDoc(path) {
    return rest(`kv_docs?path=eq.${encodeURIComponent(path)}`, { method: "DELETE" });
  },
  // canva oauth sessions
  async getSession(sid) {
    const rows = await rest(`sessions?sid=eq.${encodeURIComponent(sid)}&select=*`);
    return rows[0] || null;
  },
  async putSession(row) {
    return rest("sessions", { method: "POST", body: row });
  },
  // atomic refresh-token rotation: only one concurrent request wins
  async swapTokens(sid, oldRefresh, patch) {
    const rows = await rest(
      `sessions?sid=eq.${encodeURIComponent(sid)}&refresh=eq.${encodeURIComponent(oldRefresh)}`,
      { method: "PATCH", body: patch }
    );
    return rows.length > 0;
  },
  async putUser(uid, name) {
    return rest("users", { method: "POST", body: { uid, name } });
  },
  async getUsers(uids) {
    if (!uids.length) return [];
    const list = uids.map((u) => `"${u.replace(/"/g, "")}"`).join(",");
    return rest(`users?uid=in.(${encodeURIComponent(list)})&select=uid,name`, { headers: {} });
  },
};
