import { checkAppKey, readBody, deny } from "../lib/util.js";

// Replaces the page's "ask Claude" capability: bills your ANTHROPIC_API_KEY.
export default async function handler(req, res) {
  if (req.method !== "POST") return deny(res, 405, "bad_request", "POST only");
  if (!checkAppKey(req)) return deny(res, 401, "bad_key", "Wrong app password.");
  try {
    const { input, json, images = [], modelTier } = await readBody(req);
    if (!input) return deny(res, 400, "bad_request", "Missing input.");
    const model =
      modelTier === "quick"
        ? process.env.ANTHROPIC_MODEL_QUICK || "claude-haiku-4-5"
        : process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
    const content = [
      ...images.slice(0, 6).map((im) => ({
        type: "image",
        source: { type: "base64", media_type: im.media_type || "image/jpeg", data: im.data },
      })),
      { type: "text", text: String(input) },
    ];
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        system: json
          ? "You output only valid JSON. No prose, no code fences — the raw JSON object or array and nothing else."
          : undefined,
        messages: [{ role: "user", content }],
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const code = r.status === 429 ? "rate_limited" : "tool_error";
      return deny(res, r.status === 429 ? 429 : 502, code, data?.error?.message || `Anthropic API error ${r.status}`);
    }
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    if (!json) return res.json({ text });
    const m = text.match(/[{[][\s\S]*[}\]]/);
    if (!m) return deny(res, 502, "invalid_json", "Claude's answer couldn't be read as JSON.");
    try {
      res.json({ json: JSON.parse(m[0]), text });
    } catch {
      deny(res, 502, "invalid_json", "Claude's answer couldn't be read as JSON.");
    }
  } catch (e) {
    deny(res, 500, "tool_error", e.message || String(e));
  }
}
