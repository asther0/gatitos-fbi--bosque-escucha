import { z } from 'zod';
import { validZavuSignature } from '@/lib/zavu';
import { database } from '@/lib/supabase';
import { check, failure } from '@/lib/data';
export async function POST(request: Request) {
 try {
  const reader=request.body?.getReader(); if(!reader) return new Response(null,{status:400});
  const chunks:Uint8Array[]=[]; let size=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();return new Response(null,{status:413});}chunks.push(value);}} finally {reader.releaseLock();}
  const raw=Buffer.concat(chunks).toString('utf8');
  if(!validZavuSignature(raw,request.headers.get('x-zavu-signature'),process.env.ZAVU_WEBHOOK_SECRET)) return new Response(null,{status:401});
  const event=z.object({id:z.string().min(1).max(300),type:z.string(),data:z.object({messageId:z.string().min(1).max(300),status:z.string()})}).parse(JSON.parse(raw));
  if(!['sent','delivered','failed'].includes(event.data.status) || event.type!==`message.${event.data.status}`) return Response.json({ignored:true});
  const result=await database().rpc('be_zavu_receipt',{event_reference:event.id,message_reference:event.data.messageId,delivery_state:event.data.status});check(result.error);
  // Unknown correlation may be a callback racing the send response. Ask provider to retry.
  if(!result.data) return Response.json({error:'Correlación pendiente'},{status:503});
  return Response.json({received:true});
 }catch(error){return failure(error,400);}
}
