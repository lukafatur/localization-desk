import { checkAppKey, readCookies, readBody, deny } from "../lib/util.js";
import { accessTokenFor, mcpCallTool, toPagePayload } from "../lib/canva.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return deny(res, 405, "bad_request", "POST only");
  if (!checkAppKey(req)) return deny(res, 401, "bad_key", "Wrong app password.");
  const sid = readCookies(req).sid;
  if (!sid) return deny(res, 401, "needs_reauth", "Connect Canva first.");
  try {
    const { tool, input } = await readBody(req);
    if (!tool) return deny(res, 400, "bad_request", "Missing tool name.");
    const token = await accessTokenFor(sid);
    const result = await mcpCallTool(token, tool, input || {});
    const out = toPagePayload(result);
    res.json(out);
  } catch (e) {
    const code = e.code || "tool_error";
    const status = code === "needs_reauth" ? 401 : code === "rate_limited" ? 429 : 502;
    deny(res, status, code, e.message || String(e));
  }
}
