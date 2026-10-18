import { z } from 'zod';
import { readJson } from '@/lib/payload';
import { database } from '@/lib/supabase';
import { check, failure } from '@/lib/data';
import { validBearer } from '@/lib/zavu';
export async function POST(request: Request) {
 if (!validBearer(request.headers.get('authorization'),process.env.N8N_ZAVU_ADAPTER_SECRET)) return Response.json({error:'No autorizado'},{status:401});
 if (!process.env.ZAVUDEV_API_KEY || !process.env.ZAVU_SENDER_ID) return Response.json({error:'Falta configurar Zavu y remitente WhatsApp'},{status:503});
 try {
  const {notification_id:id} = z.object({notification_id:z.string().uuid()}).parse(await readJson(request,4096));
  if (request.headers.get('idempotency-key')!==id) return Response.json({error:'Idempotency-Key inválida'},{status:400});
  const db = database();
  const claim = await db.rpc('be_reserve_zavu',{target:id}); check(claim.error);
  if (!claim.data) return Response.json({accepted:false,status:'blocked_or_already_reserved'});
  const {incident,contact} = claim.data;
  let response: Response;
  try {
   response = await fetch('https://api.zavu.dev/v1/messages',{method:'POST',headers:{Authorization:`Bearer ${process.env.ZAVUDEV_API_KEY}`,'Content-Type':'application/json','Zavu-Sender':process.env.ZAVU_SENDER_ID},body:JSON.stringify({to:contact.destination,channel:'whatsapp',messageType:'text',text:`Bosque Escucha: ${incident.title}. Prioridad ${incident.priority}. Nodo ${incident.node_id}. Alerta revisada por operador; verificar evidencia antes de intervenir.`,fallbackEnabled:false,idempotencyKey:id}),signal:AbortSignal.timeout(15000)});
  } catch {
   check((await db.from('be_zavu_dispatches').update({state:'uncertain'}).eq('notification_id',id)).error);
   return Response.json({accepted:false,status:'uncertain',message:'Reconciliar con proveedor antes de reenviar'},{status:202});
  }
  const body = await response.json().catch(()=>null);
  const providerId = body?.message?.id;
  if (!response.ok || typeof providerId!=='string' || !providerId) {
   const uncertain = response.status===409 || response.status>=500 || response.ok;
   check((await db.from('be_zavu_dispatches').update({state:uncertain?'uncertain':'rejected'}).eq('notification_id',id)).error);
   return Response.json({accepted:false,status:uncertain?'uncertain':'rejected',provider_http_status:response.status},{status:202});
  }
  check((await db.from('be_zavu_dispatches').update({state:'accepted',provider_id:providerId}).eq('notification_id',id)).error);
  return Response.json({accepted:true,status:'queued',provider_id:providerId},{status:202});
 } catch(error) {return failure(error);}
}
