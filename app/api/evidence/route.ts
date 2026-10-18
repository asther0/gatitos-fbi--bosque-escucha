import { createHash } from "node:crypto";
import {
  isDeviceAuthorized,
  isCenterAuthorized,
  requireOperator,
} from "@/lib/auth";
import { database } from "@/lib/supabase";
import { check, failure } from "@/lib/data";
export async function POST(request: Request) {
  if (!isDeviceAuthorized(request) && !isCenterAuthorized(request))
    return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    const node = form.get("node_id");
    if (
      !(file instanceof File) ||
      typeof node !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(node)
    )
      return Response.json(
        { error: "Archivo y node_id requeridos" },
        { status: 400 },
      );
    if (file.size > 4194304 || file.size === 0)
      return Response.json(
        { error: "El límite es 4 MB y el archivo no puede estar vacío" },
        { status: 413 },
      );
    const bytes = new Uint8Array(await file.arrayBuffer());
    let extension: string;
    let mime: string;
    let type: string;
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
      extension = "jpg";
      mime = "image/jpeg";
      type = "image";
    } else if (
      bytes[0] === 137 &&
      bytes[1] === 80 &&
      bytes[2] === 78 &&
      bytes[3] === 71 &&
      bytes[4] === 13 &&
      bytes[5] === 10 &&
      bytes[6] === 26 &&
      bytes[7] === 10
    ) {
      extension = "png";
      mime = "image/png";
      type = "image";
    } else if (
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WAVE"
    ) {
      extension = "wav";
      mime = "audio/wav";
      type = "audio";
    } else
      return Response.json(
        { error: "Solo JPEG, PNG o WAV válidos" },
        { status: 415 },
      );
    const db = database();
    const found = await db
      .from("be_nodes")
      .select("id")
      .eq("id", node)
      .single();
    check(found.error);
    const path = `${node}/${createHash("sha256").update(bytes).digest("hex")}.${extension}`;
    const { error } = await db.storage
      .from("be-evidence")
      .upload(path, bytes, { contentType: mime, upsert: false });
    const duplicate =
      error &&
      String((error as { statusCode?: string | number }).statusCode) === "409";
    if (!duplicate) check(error);
    return Response.json(
      { path, type, idempotent: Boolean(duplicate) },
      { status: duplicate ? 200 : 201 },
    );
  } catch (e) {
    return failure(e, 400);
  }
}
export async function GET(request: Request) {
  const denied = requireOperator(request);
  if (denied) return denied;
  try {
    const path = new URL(request.url).searchParams.get("path");
    if (!path || !/^[A-Za-z0-9_-]+\/[a-f0-9-]+\.(jpg|png|wav)$/.test(path))
      return Response.json({ error: "Ruta inválida" }, { status: 400 });
    const { data, error } = await database()
      .storage.from("be-evidence")
      .createSignedUrl(path, 60);
    check(error);
    return new Response(null, {
      status: 307,
      headers: { Location: data!.signedUrl, "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
