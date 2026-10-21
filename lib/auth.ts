import "server-only";
import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";

export const SESSION_COOKIE = "bosque_operator";
const SESSION_SECONDS = 12 * 60 * 60;
function equal(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}
function secret(): string | undefined { return process.env.SESSION_SECRET; }
function sign(value: string): string { return createHmac("sha256", secret()!).update(value).digest("base64url"); }
export function validOperatorPassword(password: unknown): boolean {
  return typeof password === "string" && password.length < 256 && !!process.env.OPERATOR_PASSWORD && !!secret()
    && equal(password, process.env.OPERATOR_PASSWORD);
}
export function createSession(): string {
  if (!secret()) throw new Error("SESSION_SECRET is missing");
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_SECONDS * 1000, nonce: randomBytes(12).toString("hex") })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  // Next dev may rewrite request.url to localhost; the browser-set Host is the address it targeted.
  try { const host = new URL(origin).host; return host === new URL(request.url).host || host === request.headers.get("host"); } catch { return false; }
}
export function isOperator(request: Request): boolean {
  if (!secret()) return false;
  const cookie = (request.headers.get("cookie") || "").split(";").map(v => v.trim()).find(v => v.startsWith(`${SESSION_COOKIE}=`));
  const value = cookie?.slice(SESSION_COOKIE.length + 1);
  if (!value || value.length > 1024) return false;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra || !equal(signature, sign(payload))) return false;
  try { const data = JSON.parse(Buffer.from(payload, "base64url").toString()); return typeof data.exp === "number" && data.exp > Date.now(); } catch { return false; }
}
export function requireOperator(request: Request): Response | null {
  if (!sameOrigin(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  return isOperator(request) ? null : Response.json({ error: "Inicia sesión como operador." }, { status: 401 });
}
function bearerMatches(request: Request, expected?: string): boolean {
  const auth = request.headers.get("authorization") || "";
  return !!expected && auth.startsWith("Bearer ") && auth.length < 1024 && equal(auth.slice(7), expected);
}
export function isDeviceAuthorized(request: Request): boolean {
  return bearerMatches(request, process.env.DEVICE_INGEST_TOKEN) || (sameOrigin(request) && isOperator(request));
}
export function isCenterAuthorized(request: Request): boolean { return bearerMatches(request, process.env.CENTER_SYNC_TOKEN); }
export function sessionCookie(value: string, request: Request, clear = false): string {
  const secure = new URL(request.url).protocol === "https:" || process.env.NODE_ENV === "production";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_SECONDS}${secure ? "; Secure" : ""}`;
}
