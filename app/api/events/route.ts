import { readJson } from "@/lib/payload";
import { isDeviceAuthorized, isOperator } from "@/lib/auth";
import { ingest, failure, eventSchema } from "@/lib/data";
export async function POST(request: Request) {
  if (!isDeviceAuthorized(request))
    return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    const input = eventSchema.parse(await readJson(request));
    if (input.source === "local_center")
      return Response.json(
        { error: "Usa el endpoint correspondiente" },
        { status: 400 },
      );
    if (input.source === "demo") {
      if (!isOperator(request))
        return Response.json(
          { error: "Demo requiere sesión operador" },
          { status: 403 },
        );
      if (input.node_id !== "DEMO-01")
        return Response.json(
          { error: "Demo solo admite DEMO-01" },
          { status: 400 },
        );
    } else {
      input.source = isOperator(request) ? "manual" : "device";
    }
    return Response.json(await ingest(input), { status: 201 });
  } catch (e) {
    return failure(e, 400);
  }
}
