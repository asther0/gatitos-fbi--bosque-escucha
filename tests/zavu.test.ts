import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {validZavuSignature,validBearer} from '../lib/zavu';
test('signed delivery accepts authentic bytes and rejects edits, stale and v1-only',()=>{
 const now=1800000000000, t=String(now/1000), raw='{"type":"message.delivered"}', secret='unit-only';
 const sig=createHmac('sha256',secret).update(`${t}.${raw}`).digest('hex');
 assert.equal(validZavuSignature(raw,`t=${t},v2=${sig}`,secret,now),true);
 assert.equal(validZavuSignature(raw+' ',`t=${t},v2=${sig}`,secret,now),false);
 assert.equal(validZavuSignature(raw,`t=${t},v2=${sig}`,secret,now+301000),false);
 assert.equal(validZavuSignature(raw,`v1=${sig}`,secret,now),false);
 assert.equal(validZavuSignature(raw,`t=${t},v2=xx`,secret,now),false);
});
test('adapter requires configured secret and exact bearer',()=>{
 assert.equal(validBearer('Bearer test','test'),true);
 assert.equal(validBearer('Bearer wrong','test'),false);
 assert.equal(validBearer('',undefined),false);
});
