import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
export function validBearer(value: string | null, secret: string | undefined) {
  return !!secret && timingSafeEqual(createHash('sha256').update(value || '').digest(),createHash('sha256').update(`Bearer ${secret}`).digest());
}
export function validZavuSignature(raw: string, header: string | null, secret: string | undefined, now = Date.now()) {
  if (!secret || !header) return false;
  const fields = Object.fromEntries(header.split(',').map(part => part.trim().split('=')));
  if (!/^\d+$/.test(fields.t || '') || !/^[a-f0-9]{64}$/i.test(fields.v2 || '')) return false;
  if (Math.abs(now / 1000 - Number(fields.t)) > 300) return false;
  const expected = createHmac('sha256',secret).update(`${fields.t}.${raw}`).digest();
  return timingSafeEqual(expected,Buffer.from(fields.v2,'hex'));
}
