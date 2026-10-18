import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { validBearer, validKapsoSignature } from '../lib/kapso';

test('Kapso signature covers the exact raw bytes', () => {
  const secret = 'test-only-secret';
  const raw = Buffer.from('{"message":{"id":"wamid.1"}}');
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal(validKapsoSignature(raw, signature, secret), true);
  assert.equal(validKapsoSignature(Buffer.from(raw.toString() + ' '), signature, secret), false);
  assert.equal(validKapsoSignature(raw, signature, undefined), false);
  assert.equal(validKapsoSignature(raw, 'not-a-signature', secret), false);
});

test('adapter bearer requires the configured secret', () => {
  assert.equal(validBearer('Bearer test-only-secret', 'test-only-secret'), true);
  assert.equal(validBearer('Bearer wrong', 'test-only-secret'), false);
  assert.equal(validBearer('Bearer test-only-secret', undefined), false);
});
