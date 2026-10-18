import { requireOperator } from "@/lib/auth";
import { database } from "@/lib/supabase";
import { check, failure } from "@/lib/data";
import { z } from "zod";

export async function POST(request: Request) {
  const denied = requireOperator(request);
  if (denied) return denied;
  try {
    const node = z
      .object({
        id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        name: z.string().min(1).max(200),
        sector: z.string().min(1).max(200),
        latitude: z.number().min(-90).max(90).nullable(),
        longitude: z.number().min(-180).max(180).nullable(),
      })
      .parse(await request.json());
    const { data, error } = await database()
      .from("be_nodes")
      .upsert(node)
      .select()
      .single();
    check(error);
    return Response.json({ node: data });
  } catch (error) {
    return failure(error, 400);
  }
}
