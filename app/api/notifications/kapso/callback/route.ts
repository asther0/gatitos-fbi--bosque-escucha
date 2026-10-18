import { z } from 'zod';
import { validKapsoSignature } from '@/lib/kapso';
import { database } from '@/lib/supabase';
import { check, failure } from '@/lib/data';

const eventSchema = z.object({
  phone_number_id: z.string(),
  message: z.object({ id: z.string().min(1).max(300), kapso: z.object({ direction: z.string(), status: z.string() }) }),
});

export async function POST(request: Request) {
  try {
    const raw = Buffer.from(await request.arrayBuffer());
    if (raw.length > 65536) return new Response(null, { status: 413 });
    if (!validKapsoSignature(raw, request.headers.get('x-webhook-signature'), process.env.KAPSO_WEBHOOK_SECRET))
      return new Response(null, { status: 401 });
    const eventType = request.headers.get('x-webhook-event');
    const status = eventType?.replace(/^whatsapp\.message\./, '');
    if (!['sent', 'delivered', 'failed'].includes(status || '') || eventType !== `whatsapp.message.${status}`)
      return Response.json({ ignored: true });
    const event = eventSchema.parse(JSON.parse(raw.toString('utf8')));
    if (event.phone_number_id !== process.env.KAPSO_PHONE_NUMBER_ID || event.message.kapso.direction !== 'outbound' || event.message.kapso.status !== status)
      return Response.json({ ignored: true });
    const eventId = request.headers.get('x-idempotency-key');
    if (!eventId || eventId.length > 300) return Response.json({ error: 'Falta X-Idempotency-Key' }, { status: 400 });
    const result = await database().rpc('be_kapso_receipt', { event_reference: eventId, message_reference: event.message.id, delivery_state: status });
    check(result.error);
    if (!result.data) {
      // Arvid Company also sends messages unrelated to Bosque Escucha. Retry
      // only while one of our sends may still be awaiting its provider ID.
      const recent = await database().from('be_kapso_dispatches').select('notification_id').eq('state', 'reserved').gte('created_at', new Date(Date.now() - 60_000).toISOString()).limit(1);
      check(recent.error);
      if (recent.data?.length) return Response.json({ error: 'Correlación pendiente' }, { status: 503 });
      return Response.json({ ignored: true });
    }
    return Response.json({ received: true });
  } catch (error) { return failure(error, 400); }
}
