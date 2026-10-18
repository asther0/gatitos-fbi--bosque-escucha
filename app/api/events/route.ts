import { isDeviceAuthorized, isOperator } from "@/lib/auth";
import { ingest, failure, eventSchema } from "@/lib/data";
export async function POST(request: Request) {
  if (!isDeviceAuthorized(request))
    return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    const input = eventSchema.parse(await request.json());
    if (input.source === "demo" || input.source === "local_center")
      return Response.json(
        { error: "Usa el endpoint correspondiente" },
        { status: 400 },
      );
    input.source = isOperator(request) ? "manual" : "device";
    return Response.json(await ingest(input), { status: 201 });
  } catch (e) {
    return failure(e, 400);
  }
}
