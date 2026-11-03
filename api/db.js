import { checkAppKey, readBody, deny } from "../lib/util.js";
import { supa } from "../lib/supa.js";

// Shared storage for projects and translation rows (replaces the artifact's db capability).
export default async function handler(req, res) {
  if (req.method !== "POST") return deny(res, 405, "bad_request", "POST only");
  if (!checkAppKey(req)) return deny(res, 401, "bad_key", "Wrong app password.");
  try {
    const { op, path, collection, data, orderBy, dir, uids } = await readBody(req);
    if (op === "list") {
      const rows = await supa.listDocs(collection);
      let docs = rows.map((r) => ({ id: r.path.split("/").pop(), path: r.path, data: r.data }));
      if (orderBy) {
        docs.sort((a, b) => {
          const x = a.data?.[orderBy], y = b.data?.[orderBy];
          const c = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""));
          return dir === "desc" ? -c : c;
        });
      }
      return res.json({ docs });
    }
    if (op === "set") {
      const col = path.split("/").slice(0, -1).join("/");
      await supa.setDoc(path, col, data);
      return res.json({ ok: true });
    }
    if (op === "update") {
      try { await supa.updateDoc(path, data); }
      catch (e) {
        if (String(e.message) === "not_found") { const col = path.split("/").slice(0, -1).join("/"); await supa.setDoc(path, col, data); }
        else throw e;
      }
      return res.json({ ok: true });
    }
    if (op === "delete") {
      await supa.deleteDoc(path);
      return res.json({ ok: true });
    }
    if (op === "profiles") {
      const rows = await supa.getUsers(uids || []);
      return res.json({ profiles: Object.fromEntries(rows.map((r) => [r.uid, { name: r.name || "" }])) });
    }
    deny(res, 400, "bad_request", "Unknown op.");
  } catch (e) {
    deny(res, 500, "tool_error", e.message || String(e));
  }
}
