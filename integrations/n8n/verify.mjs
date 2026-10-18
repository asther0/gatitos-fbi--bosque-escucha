import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const load = name => JSON.parse(readFileSync(new URL(name + '.json', import.meta.url)));
const run = (code, items=[]) => vm.runInNewContext('(function(){' + code + '})()', {$input:{all:()=>items}}, {timeout:1000});
const a=load('notificaciones'), b=load('asistente-incidente');
for (const w of [a,b]) {
 assert.equal(w.active,false);
 assert.equal(w.nodes.filter(n=>n.type==='n8n-nodes-base.manualTrigger').length,1);
 assert(w.nodes.every(n=>['n8n-nodes-base.manualTrigger','n8n-nodes-base.code','n8n-nodes-base.stickyNote'].includes(n.type)));
 assert(w.nodes.every(n=>!n.credentials));
}
const fixture=run(a.nodes[1].parameters.jsCode);
const check=items=>run(a.nodes[2].parameters.jsCode,items);
const initial=check(fixture)[0].json;
for (const reason of ['demo_rejected','not_approved','missing_or_invalid_contact','synthetic_rejected']) assert(initial.validation.reasons.includes(reason));
const base=JSON.parse(JSON.stringify(fixture[0].json));
base.synthetic=false; base.source='device'; base.incident.node_id='SYNTHETIC-TEST-ONLY';
base.incident.status='verified'; base.notification.approved_by='synthetic-test-operator';
base.contact={id:'synthetic-contact',enabled:true,destination:'+12025550123',channel:'sms'};
base.notification.contact_id=base.contact.id; base.notification.destination=base.contact.destination;
const cases=[
 ['baseline', p=>{}, null],
 ['demo', p=>{p.source='demo'}, 'demo_rejected'],
 ['unapproved', p=>{p.notification.approved_by=''}, 'not_approved'],
 ['unreviewed', p=>{p.incident.status='pending_review'}, 'not_approved'],
 ['missing-contact', p=>{p.contact=null}, 'missing_or_invalid_contact'],
 ['disabled-contact', p=>{p.contact.enabled=false}, 'missing_or_invalid_contact'],
 ['mismatch', p=>{p.notification.destination='+12025550124'}, 'contact_mismatch'],
 ['local-worker', p=>{p.notification.channel='sms'}, 'not_cloud_owned']
];
for(const [name,mutate,reason] of cases){
 const p=structuredClone(base); mutate(p); const out=check([{json:p}])[0].json;
 if(reason) assert(out.validation.reasons.includes(reason),name); else assert.equal(out.validation.accepted,true);
 assert.equal(out.dry_run,true); assert.equal(out.dispatch_allowed,false); assert.equal(out.provider_call_performed,false);
 assert.equal(out.status,'pending_configuration');
 for(const field of ['provider_id','sent_at','delivered_at','acknowledged_at']) assert.equal(out[field],null);
}
assert.equal(check([]).length,0);
assert.equal(check([{json:{}}])[0].json.validation.accepted,false);
const summary=run(b.nodes[2].parameters.jsCode,run(b.nodes[1].parameters.jsCode))[0].json;
assert.equal(summary.method,'deterministic_code_not_llm');
assert.equal(summary.facts.events[0].confidence_score,0.83);
assert.equal(summary.provenance.external_sources.length,0);
assert.equal(summary.provenance.retrieval_performed,false);
assert.equal(summary.automatic_notification,false);
assert.equal(summary.human_review_required,true);
console.log('PASS: graph safety, synthetic chain, 8 notification cases, empty/missing input, deterministic summary. Local JavaScript only; no n8n execution.');

