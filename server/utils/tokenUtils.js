import crypto from 'crypto';

export function generateRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
