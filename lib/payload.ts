import { z } from "zod";

export const metadataSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= 16_384,
    "Metadata supera 16 KB",
  );

export class PayloadError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// Bound streamed requests even when Content-Length is missing or dishonest.
export async function readJson(
  request: Request,
  limit = 65_536,
): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > limit)
    throw new PayloadError("Payload demasiado grande", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new PayloadError("JSON requerido", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new PayloadError("Payload demasiado grande", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
