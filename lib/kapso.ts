import { createHmac, timingSafeEqual } from 'node:crypto';

export function validBearer(value: string | null, secret: string | undefined) {
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(value || '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validKapsoSignature(raw: Buffer, header: string | null, secret: string | undefined) {
  if (!secret || !header || !/^[a-f0-9]{64}$/i.test(header)) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(header, 'hex'));
}
