import { checkAppKey, readCookies, deny } from "../lib/util.js";
import { accessTokenFor, mcpListTools } from "../lib/canva.js";

// GET /api/mcp-tools          -> names + auth status (the page's account chip uses this)
// GET /api/mcp-tools?full=1   -> full schemas, for finishing the tool-name adapter
export default async function handler(req, res) {
  if (!checkAppKey(req)) return deny(res, 401, "bad_key", "Wrong app password.");
  const sid = readCookies(req).sid;
  if (!sid) return res.json({ servers: [{ server: "Canva", authStatus: "unknown", tools: [] }] });
  try {
    const token = await accessTokenFor(sid);
    const tools = await mcpListTools(token);
    if (req.query.full) return res.json({ tools });
    res.json({ servers: [{ server: "Canva", authStatus: "connected", tools: tools.map((t) => ({ name: t.name })) }] });
  } catch (e) {
    const st = e.code === "needs_reauth" ? "needs_reauth" : "unknown";
    res.json({ servers: [{ server: "Canva", authStatus: st, tools: [] }], error: e.message });
  }
}
