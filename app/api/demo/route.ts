import { readJson } from "@/lib/payload";
import { requireOperator } from "@/lib/auth";
import { ingest, failure } from "@/lib/data";
import { z } from "zod";
export async function POST(request: Request) {
  const denied = requireOperator(request);
  if (denied) return denied;
  try {
    const { scenario } = z
      .object({ scenario: z.enum(["chainsaw", "combined", "ambient"]) })
      .parse(await readJson(request));
    const base = {
      node_id: "DEMO-01",
      confidence: 0.88,
      source: "demo" as const,
      metadata: { simulated: true, scenario },
      detected_at: new Date().toISOString(),
    };
    const first = await ingest({
      ...base,
      event_type: scenario === "ambient" ? "ambient" : "chainsaw",
      persistent: scenario !== "ambient",
    });
    const second =
      scenario === "combined"
        ? await ingest({ ...base, event_type: "person", confidence: 0.81 })
        : null;
    return Response.json(
      {
        event: second?.event || first.event,
        incident: second?.incident || first.incident,
        events: second ? [first.event, second.event] : [first.event],
        demo: true,
      },
      { status: 201 },
    );
  } catch (e) {
    return failure(e, 400);
  }
}
