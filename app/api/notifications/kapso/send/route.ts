import { z } from 'zod';
import { readJson } from '@/lib/payload';
import { database } from '@/lib/supabase';
import { check, failure } from '@/lib/data';
import { validBearer } from '@/lib/kapso';
import { formatKapsoAlert } from '@/lib/kapso-message';

export async function POST(request: Request) {
  if (!validBearer(request.headers.get('authorization'), process.env.N8N_KAPSO_ADAPTER_SECRET))
    return Response.json({ error: 'No autorizado' }, { status: 401 });
  const apiKey = process.env.KAPSO_API_KEY;
  const phoneId = process.env.KAPSO_PHONE_NUMBER_ID;
  if (!apiKey || !phoneId || !/^\d+$/.test(phoneId))
    return Response.json({ error: 'Falta configurar Kapso y número WhatsApp' }, { status: 503 });
  try {
    const { notification_id: id } = z.object({ notification_id: z.string().uuid() }).parse(await readJson(request, 4096));
    if (request.headers.get('idempotency-key') !== id)
      return Response.json({ error: 'Idempotency-Key inválida' }, { status: 400 });
    const db = database();
    const claim = await db.rpc('be_reserve_kapso', { target: id });
    check(claim.error);
    if (!claim.data) return Response.json({ accepted: false, status: 'blocked_or_already_reserved' });
    const { incident, contact } = claim.data;
    let response: Response;
    try {
      response = await fetch(`https://api.kapso.ai/meta/whatsapp/v24.0/${phoneId}/messages`, {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: contact.destination.slice(1),
          type: 'text',
          text: { body: formatKapsoAlert(incident, contact) },
        }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      check((await db.from('be_kapso_dispatches').update({ state: 'uncertain' }).eq('notification_id', id)).error);
      return Response.json({ accepted: false, status: 'uncertain', message: 'Reconciliar con Kapso antes de reenviar' }, { status: 202 });
    }
    const body = await response.json().catch(() => null);
    const providerId = body?.messages?.[0]?.id;
    if (!response.ok || typeof providerId !== 'string' || !providerId) {
      const uncertain = response.status >= 500 || response.ok;
      check((await db.from('be_kapso_dispatches').update({ state: uncertain ? 'uncertain' : 'rejected' }).eq('notification_id', id)).error);
      return Response.json({ accepted: false, status: uncertain ? 'uncertain' : 'rejected', provider_http_status: response.status }, { status: 202 });
    }
    check((await db.from('be_kapso_dispatches').update({ state: 'accepted', provider_id: providerId }).eq('notification_id', id)).error);
    return Response.json({ accepted: true, status: 'queued', provider_id: providerId }, { status: 202 });
  } catch (error) { return failure(error); }
}
