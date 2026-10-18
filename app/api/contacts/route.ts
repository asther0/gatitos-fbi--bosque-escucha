import { readJson } from "@/lib/payload";
import { requireOperator } from "@/lib/auth";
import { database } from "@/lib/supabase";
import { check, failure } from "@/lib/data";
import { z } from "zod";

export async function GET(request: Request) {
  const denied = requireOperator(request);
  if (denied) return denied;
  try {
    const { data, error } = await database()
      .from("be_contacts")
      .select("*")
      .order("created_at");
    check(error);
    return Response.json({ contacts: data });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  const denied = requireOperator(request);
  if (denied) return denied;
  try {
    const contact = z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(120),
        sector: z.string().min(1).max(200),
        destination: z.string().regex(/^\+[1-9]\d{7,14}$/),
        channel: z.enum(["whatsapp", "sms"]).default("whatsapp"),
        enabled: z.boolean().default(true),
      })
      .parse(await readJson(request));
    const { data, error } = await database()
      .from("be_contacts")
      .upsert(contact)
      .select()
      .single();
    check(error);
    return Response.json({ contact: data });
  } catch (error) {
    return failure(error, 400);
  }
}
