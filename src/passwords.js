import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function passwordHash(value, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(value, salt, 64).toString('hex')}`;
}
export function passwordMatches(value, saved) {
  if (typeof saved !== 'string' || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(saved)) return false;
  const [salt, digest] = saved.split(':');
  return timingSafeEqual(scryptSync(value, salt, 64), Buffer.from(digest, 'hex'));
}
