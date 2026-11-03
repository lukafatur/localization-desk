import { checkAppKey, readCookies, deny } from "../lib/util.js";
import { supa } from "../lib/supa.js";

export default async function handler(req, res) {
  if (!checkAppKey(req)) return deny(res, 401, "bad_key", "Wrong app password.");
  const sid = readCookies(req).sid;
  if (!sid) return res.json({ canva: false });
  const s = await supa.getSession(sid).catch(() => null);
  if (!s) return res.json({ canva: false });
  res.json({ canva: true, uid: s.uid, name: s.name || "" });
}
