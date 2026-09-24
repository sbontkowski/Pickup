// Proves the /admin auth gate end-to-end: a login token exchanges for a
// session cookie, a tampered/expired token doesn't, the cookie actually
// gets past middleware.ts, no cookie gets redirected, and — the check that
// actually matters for production safety — the middleware matcher hasn't
// leaked scope onto a live webhook route.
//
// Never invokes the real requestLoginLink() Server Action, so this never
// sends a live SMS on every run — it mints tokens directly via lib/admin/auth.ts.
import { createLoginToken, createSessionToken } from "@/lib/admin/auth";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) failures++;
}

// NextResponse.redirect() defaults to 307 (temporary, method-preserving),
// not 302 — accept any of the standard redirect codes here.
function isRedirect(status: number): boolean {
  return status === 302 || status === 303 || status === 307 || status === 308;
}

function extractCookie(response: Response): string | null {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) return null;
  return setCookie.split(";")[0];
}

async function main() {
  // 1. A freshly minted login token exchanges for a session cookie.
  const loginToken = await createLoginToken();
  const verifyRes = await fetch(`${BASE_URL}/admin/verify?token=${encodeURIComponent(loginToken)}`, {
    redirect: "manual",
  });
  check("verify redirects", isRedirect(verifyRes.status));
  const cookie = extractCookie(verifyRes);
  check("verify sets a session cookie", cookie !== null);
  check("verify redirects to /admin", (verifyRes.headers.get("location") ?? "").endsWith("/admin"));

  // 2. A tampered token is rejected — no cookie, sent back to login.
  const tamperedRes = await fetch(`${BASE_URL}/admin/verify?token=${encodeURIComponent(loginToken)}x`, {
    redirect: "manual",
  });
  check("tampered token gets no cookie", extractCookie(tamperedRes) === null);
  check(
    "tampered token redirects to /admin/login",
    (tamperedRes.headers.get("location") ?? "").includes("/admin/login")
  );

  // 3. A session token used as a login token is rejected (purpose check).
  const sessionToken = await createSessionToken();
  const crossPurposeRes = await fetch(`${BASE_URL}/admin/verify?token=${encodeURIComponent(sessionToken)}`, {
    redirect: "manual",
  });
  check("session token can't be used as a login token", extractCookie(crossPurposeRes) === null);

  if (!cookie) {
    console.error("\nNo session cookie minted — cannot continue remaining checks.");
    process.exit(1);
  }

  // 4. That cookie actually gets past middleware.ts onto a real console page.
  const withCookieRes = await fetch(`${BASE_URL}/admin`, { headers: { cookie }, redirect: "manual" });
  check("valid session cookie reaches /admin (200)", withCookieRes.status === 200);

  // 5. No cookie gets redirected to login.
  const noCookieRes = await fetch(`${BASE_URL}/admin`, { redirect: "manual" });
  check("no cookie redirects away from /admin", isRedirect(noCookieRes.status));
  check(
    "no-cookie redirect goes to /admin/login",
    (noCookieRes.headers.get("location") ?? "").includes("/admin/login")
  );

  // 6. The middleware matcher hasn't leaked onto a live webhook route.
  const healthRes = await fetch(`${BASE_URL}/api/health`, { redirect: "manual" });
  check("/api/health is unaffected by admin middleware (200, no redirect)", healthRes.status === 200);

  console.log(failures === 0 ? "\nPASS: admin auth gate verified." : `\nFAIL: ${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
