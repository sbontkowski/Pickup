import { env } from "@/lib/env";

// Web Crypto (globalThis.crypto.subtle), not node:crypto — this module is
// imported from both middleware.ts (Edge runtime, no node:crypto) and
// Node-runtime route handlers/Server Actions. No session table exists:
// tokens are stateless, self-verifying HMAC-signed strings. Rotating
// ADMIN_SESSION_SECRET is how every outstanding session gets killed at
// once — there's no other revocation mechanism, by design.

const LOGIN_TOKEN_TTL_MS = 10 * 60 * 1000;
const SESSION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE_NAME = "pickup_admin_session";
export const SESSION_COOKIE_MAX_AGE_SECONDS = SESSION_TOKEN_TTL_MS / 1000;

type TokenPurpose = "login" | "session";

interface TokenPayload {
  purpose: TokenPurpose;
  exp: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getHmacKey(): Promise<CryptoKey> {
  const secret = new TextEncoder().encode(env.ADMIN_SESSION_SECRET);
  return crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signPayload(payload: TokenPayload): Promise<string> {
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await getHmacKey();
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${base64UrlEncode(new Uint8Array(signature))}`;
}

// Purpose is checked so a login token (which travels over SMS, and can sit
// in a phone's message history) can never be replayed as a session token.
async function verifyToken(token: string, expectedPurpose: TokenPurpose): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, signatureB64] = parts;

  let signatureBytes: Uint8Array;
  let payload: TokenPayload;
  try {
    signatureBytes = base64UrlDecode(signatureB64);
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
  } catch {
    return false;
  }

  const key = await getHmacKey();
  const validSignature = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes as BufferSource,
    new TextEncoder().encode(payloadB64)
  );
  if (!validSignature) return false;

  if (payload.purpose !== expectedPurpose) return false;
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) return false;

  return true;
}

export function createLoginToken(): Promise<string> {
  return signPayload({ purpose: "login", exp: Date.now() + LOGIN_TOKEN_TTL_MS });
}

export function verifyLoginToken(token: string): Promise<boolean> {
  return verifyToken(token, "login");
}

export function createSessionToken(): Promise<string> {
  return signPayload({ purpose: "session", exp: Date.now() + SESSION_TOKEN_TTL_MS });
}

export function verifySessionToken(token: string): Promise<boolean> {
  return verifyToken(token, "session");
}
