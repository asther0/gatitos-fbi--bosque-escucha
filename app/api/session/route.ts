import { createSession, isOperator, sameOrigin, sessionCookie, validOperatorPassword } from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return Response.json({ authenticated: isOperator(request) }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  if (!process.env.OPERATOR_PASSWORD || !process.env.SESSION_SECRET) return Response.json({ error: "Acceso de operador pendiente de configurar." }, { status: 503 });
  if (Number(request.headers.get("content-length")) > 2048) return Response.json({error:"Solicitud demasiado grande."},{status:413});
  let body: {password?: unknown};
  try { body = await request.json(); } catch { return Response.json({ error: "JSON inválido." }, { status: 400 }); }
  if (!validOperatorPassword(body.password)) return Response.json({ error: "Clave de operador incorrecta." }, { status: 401 });
  return Response.json({ authenticated: true }, { headers: { "Set-Cookie": sessionCookie(createSession(), request), "Cache-Control": "no-store" } });
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  return Response.json({ authenticated: false }, { headers: { "Set-Cookie": sessionCookie("", request, true), "Cache-Control": "no-store" } });
}
