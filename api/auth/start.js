import crypto from "node:crypto";
import { checkAppKey, setCookie, b64url, rid } from "../../lib/util.js";
import { AUTH_URL, SCOPES } from "../../lib/canva.js";

export default async function handler(req, res) {
  if (!checkAppKey(req)) return res.status(401).send("Wrong app password. Go back and sign in first.");
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = rid(12);
  setCookie(res, "pkce", `${verifier}.${state}`, { maxAge: 600 });
  const redirectUri = `${process.env.APP_URL}/api/auth/callback`;
  const u = new URL(AUTH_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", process.env.CANVA_CLIENT_ID);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", state);
  res.writeHead(302, { Location: u.toString() });
  res.end();
}
