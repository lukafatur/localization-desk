import { checkAppKey, readCookies, readBody, deny } from "../lib/util.js";
import { accessTokenFor, mcpCallTool, toPagePayload } from "../lib/canva.js";
import { readDesignAdapter, editDesignAdapter } from "../lib/adapter.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return deny(res, 405, "bad_request", "POST only");
  if (!checkAppKey(req)) return deny(res, 401, "bad_key", "Wrong app password.");
  const sid = readCookies(req).sid;
  if (!sid) return deny(res, 401, "needs_reauth", "Connect Canva first.");
  try {
    const { tool, input: rawInput } = await readBody(req);
    if (!tool) return deny(res, 400, "bad_request", "Missing tool name.");
    // user_intent was a claude.ai-connector convention; the public server's schemas don't know it.
    const { user_intent, ...input } = rawInput || {};
    const token = await accessTokenFor(sid);
    let out;
    if (tool === "read-design") out = await readDesignAdapter(token, input);
    else if (tool === "edit-design") out = await editDesignAdapter(token, input);
    else out = toPagePayload(await mcpCallTool(token, tool, input));
    res.json(out);
  } catch (e) {
    const code = e.code || "tool_error";
    const status = code === "needs_reauth" ? 401 : code === "rate_limited" ? 429 : 502;
    deny(res, status, code, e.message || String(e));
  }
}
