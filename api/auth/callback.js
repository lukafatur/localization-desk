import { readCookies, setCookie, rid } from "../../lib/util.js";
import { exchangeCode } from "../../lib/canva.js";
import { supa } from "../../lib/supa.js";

export default async function handler(req, res) {
  try {
    const { code, state, error, error_description } = req.query;
    if (error) return res.status(400).send(`Canva said no: ${error_description || error}`);
    const pkce = readCookies(req).pkce || "";
    const [verifier, wantState] = pkce.split(".");
    if (!verifier || !code) return res.status(400).send("Missing code or PKCE cookie. Start the login again from the app.");
    if (wantState && state !== wantState) return res.status(400).send("State mismatch. Start the login again from the app.");

    const t = await exchangeCode(code, verifier, `${process.env.APP_URL}/api/auth/callback`);

    // Who is this? (for the "by" column in the review table and the account chip)
    let uid = "u_" + rid(6), name = "";
    try {
      const me = await fetch("https://api.canva.com/rest/v1/users/me", { headers: { Authorization: `Bearer ${t.access_token}` } }).then(r => r.json());
      uid = me?.team_user?.user_id || me?.user_id || uid;
      const prof = await fetch("https://api.canva.com/rest/v1/users/me/profile", { headers: { Authorization: `Bearer ${t.access_token}` } }).then(r => r.json()).catch(() => null);
      name = prof?.profile?.display_name || prof?.display_name || "";
    } catch {}

    const sid = rid(24);
    await supa.putSession({
      sid, uid, name,
      access: t.access_token,
      refresh: t.refresh_token,
      expires_at: new Date(Date.now() + (t.expires_in || 14400) * 1000).toISOString(),
    });
    if (name || uid) await supa.putUser(uid, name).catch(() => {});
    setCookie(res, "sid", sid);
    setCookie(res, "pkce", "", { maxAge: 0 });
    res.writeHead(302, { Location: "/" });
    res.end();
  } catch (e) {
    res.status(500).send("Login failed: " + (e?.message || e));
  }
}
