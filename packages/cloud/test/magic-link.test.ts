import { describe, expect, it } from "vitest";
import { MagicLinkError, parseMagicLink, redeemMagicLink } from "../../../scripts/magic-link.mjs";

const PROJECT = "https://abcdefgh.supabase.co";
const LINK = `${PROJECT}/auth/v1/verify?token=SECRETTOKEN123&type=magiclink&redirect_to=http%3A%2F%2Flocalhost%3A3000`;

const reply = (status: number, location?: string) => async () => ({ status, headers: { get: (h: string) => (h.toLowerCase() === "location" ? (location ?? null) : null) } });
const msgOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))!;

describe("parseMagicLink: only this project's verify endpoint is ever requested", () => {
  it("accepts the project's own verify link", () => {
    expect(parseMagicLink(LINK, PROJECT).searchParams.get("token")).toBe("SECRETTOKEN123");
    expect(parseMagicLink(`  ${LINK}\n`, PROJECT).pathname).toBe("/auth/v1/verify"); // pasted with whitespace
  });
  it("rejects other hosts, so a pasted link can never send a request elsewhere", () => {
    for (const bad of [
      "https://evil.example.com/auth/v1/verify?token=x",
      "https://abcdefgh.supabase.co.evil.com/auth/v1/verify?token=x",
      "https://other-project.supabase.co/auth/v1/verify?token=x",
      "http://abcdefgh.supabase.co/auth/v1/verify?token=x", // wrong scheme = different origin
      "https://user:pw@evil.example.com/auth/v1/verify?token=x",
    ]) expect(() => parseMagicLink(bad, PROJECT)).toThrow(MagicLinkError);
  });
  it("rejects other paths on the right host", () => {
    expect(() => parseMagicLink(`${PROJECT}/rest/v1/projects?token=x`, PROJECT)).toThrow(/verify/);
    expect(() => parseMagicLink(`${PROJECT}/auth/v1/user?token=x`, PROJECT)).toThrow(/verify/);
  });
  it("rejects non-links, empty input and links without a token", () => {
    for (const bad of ["", "hello", undefined, null, "javascript:alert(1)", "file:///etc/passwd"]) expect(() => parseMagicLink(bad, PROJECT)).toThrow(MagicLinkError);
    expect(() => parseMagicLink(`${PROJECT}/auth/v1/verify?type=magiclink`, PROJECT)).toThrow(/no sign-in token/);
  });
  it("never echoes the pasted text in its error", () => {
    const secret = "https://evil.example.com/auth/v1/verify?token=SUPERSECRET";
    try {
      parseMagicLink(secret, PROJECT);
    } catch (e) {
      expect((e as Error).message).not.toMatch(/SUPERSECRET|evil\.example/);
    }
  });
});

describe("redeemMagicLink", () => {
  it("returns the session tokens from the redirect fragment, requesting without following redirects", async () => {
    let seen: { url?: string; init?: unknown } = {};
    const tokens = await redeemMagicLink(LINK, PROJECT, async (url, init) => {
      seen = { url: String(url), init };
      return reply(303, "http://localhost:3000/#access_token=AT.AAA.BBB&expires_in=3600&refresh_token=RT123&token_type=bearer&type=magiclink")();
    });
    expect(tokens).toEqual({ access_token: "AT.AAA.BBB", refresh_token: "RT123" });
    expect(seen.url).toBe(LINK);
    expect(seen.init).toEqual({ redirect: "manual" });
  });

  it("reports an expired or used link clearly (error in the fragment), without leaking the link", async () => {
    const e = await msgOf(redeemMagicLink(LINK, PROJECT, reply(303, "http://localhost:3000/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")));
    expect(e).toBeInstanceOf(MagicLinkError);
    expect(e.message).toMatch(/otp_expired/);
    expect(e.message).toMatch(/single-use/);
    expect(e.message).toMatch(/Email link is invalid or has expired/);
    expect(e.message).not.toMatch(/SECRETTOKEN123/);
  });
  it("also understands errors delivered in the query string", async () => {
    const e = await msgOf(redeemMagicLink(LINK, PROJECT, reply(303, "http://localhost:3000/?error=access_denied&error_code=otp_expired")));
    expect(e.message).toMatch(/otp_expired/);
  });
  it("fails clearly when there is no redirect, a redirect without a session, or the network is down", async () => {
    expect((await msgOf(redeemMagicLink(LINK, PROJECT, reply(400)))).message).toMatch(/HTTP 400/);
    expect((await msgOf(redeemMagicLink(LINK, PROJECT, reply(303, "http://localhost:3000/#type=magiclink")))).message).toMatch(/without a session/);
    expect((await msgOf(redeemMagicLink(LINK, PROJECT, reply(303, "http://localhost:3000/#access_token=only-this")))).message).toMatch(/without a session/);
    expect((await msgOf(redeemMagicLink(LINK, PROJECT, async () => { throw new Error("ECONNRESET to secret-host"); }))).message).not.toMatch(/ECONNRESET|secret-host/);
  });
  it("never makes a request when the link is invalid", async () => {
    let called = false;
    await msgOf(redeemMagicLink("https://evil.example.com/auth/v1/verify?token=x", PROJECT, async () => { called = true; return reply(303)(); }));
    expect(called).toBe(false);
  });
  it("tokens never appear in error messages", async () => {
    const e = await msgOf(redeemMagicLink(LINK, PROJECT, reply(303, "http://localhost:3000/#access_token=LEAKME&error_code=server_error")));
    expect(e.message).not.toMatch(/LEAKME/);
  });
});
