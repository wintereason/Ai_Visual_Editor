// Redeems a default Supabase magic-link email WITHOUT a browser, custom SMTP or a {{ .Token }} template.
//
// The link in the email is  https://<ref>.supabase.co/auth/v1/verify?token=...&type=magiclink&redirect_to=...
// Supabase answers it with a 303 redirect whose #fragment carries the session (access_token + refresh_token),
// or an error. We read that redirect ourselves instead of letting a browser follow it, so it does not matter whether
// the editor is running or what the Site URL / Redirect URLs are set to.
//
// Security rules enforced here:
//   * The pasted link is only ever requested if it points at THIS project's /auth/v1/verify endpoint, so a pasted
//     link can never make the script send a request (or tokens) anywhere else.
//   * Neither the link nor the resulting tokens are ever included in an error message or logged.

export class MagicLinkError extends Error {
  constructor(message) {
    super(message);
    this.name = "MagicLinkError";
  }
}

/** Validate a pasted link against the project URL. Returns the URL to request. Never echoes the input. */
export function parseMagicLink(link, projectUrl) {
  let u;
  try {
    u = new URL(String(link ?? "").trim());
  } catch {
    throw new MagicLinkError("That does not look like a link. Right-click the button in the email and choose 'Copy link address'.");
  }
  const base = new URL(projectUrl);
  if (u.protocol !== "https:" && u.origin !== base.origin) throw new MagicLinkError("The link must be an https link.");
  if (u.origin !== base.origin || u.pathname !== "/auth/v1/verify") {
    throw new MagicLinkError(
      `Expected a link to ${base.host}/auth/v1/verify (the sign-in button in the Supabase email). ` +
        "If the link starts with something else, copy the address of the button itself, not a page you landed on.",
    );
  }
  if (!u.searchParams.get("token")) throw new MagicLinkError("The link has no sign-in token; copy the full link from the email.");
  return u;
}

/** Collect parameters from both the query string and the #fragment of a redirect target. */
export function redirectParams(location, base) {
  const u = new URL(location, base);
  const params = new URLSearchParams(u.search);
  for (const [k, v] of new URLSearchParams(u.hash.replace(/^#/, ""))) params.set(k, v);
  return params;
}

/**
 * Follow the verify link once, without following the redirect, and return the session tokens.
 * `fetchImpl` is injectable for tests.
 */
export async function redeemMagicLink(link, projectUrl, fetchImpl = fetch) {
  const target = parseMagicLink(link, projectUrl);
  let res;
  try {
    res = await fetchImpl(target, { redirect: "manual" });
  } catch {
    throw new MagicLinkError("Could not reach Supabase. Check your internet connection and try again.");
  }
  const location = res.headers.get("location");
  if (!location) {
    throw new MagicLinkError(`Supabase did not respond with a sign-in redirect (HTTP ${res.status}). The link may be malformed or already used.`);
  }
  const p = redirectParams(location, projectUrl);

  const code = p.get("error_code") || p.get("error");
  if (code) {
    const why = (p.get("error_description") || "").replace(/\+/g, " ").slice(0, 120);
    const hint = code === "otp_expired" ? " Magic links are single-use and expire after an hour; some email scanners open them first. Request a new one." : "";
    throw new MagicLinkError(`Supabase refused the link: ${code}${why ? ` (${why})` : ""}.${hint}`);
  }
  const access_token = p.get("access_token");
  const refresh_token = p.get("refresh_token");
  if (!access_token || !refresh_token) throw new MagicLinkError("Supabase redirected without a session. Request a new link and try again.");
  return { access_token, refresh_token };
}
