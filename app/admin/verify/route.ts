import { NextResponse } from "next/server";
import {
  verifyLoginToken,
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/admin/auth";

// Consumes a login token from the SMS link, mints a session token, and
// sets it as the /admin session cookie. A bare GET route handler, not a
// Server Action, because this has to handle a link tapped straight out of
// the Messages app, not a form submission.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const loginUrl = new URL("/admin/login", request.url);

  if (!token || !(await verifyLoginToken(token))) {
    loginUrl.searchParams.set("error", "1");
    return NextResponse.redirect(loginUrl);
  }

  const sessionToken = await createSessionToken();
  const response = NextResponse.redirect(new URL("/admin", request.url));
  response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/admin",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
