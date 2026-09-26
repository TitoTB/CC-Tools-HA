import crypto from 'crypto';
import { readConfig, writeConfig } from './storage.js';

const SESSION_COOKIE = 'cctools_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export { SESSION_COOKIE };

export async function ensureInitialPassword() {
  const config = await readConfig();
  if (config.auth.passwordHash && config.auth.passwordSalt) return;

  const initialPassword = process.env.CCTOOLS_INITIAL_PASSWORD || crypto.randomBytes(18).toString('base64url');
  const auth = hashPassword(initialPassword);
  config.auth.passwordHash = auth.hash;
  config.auth.passwordSalt = auth.salt;
  await writeConfig(config);

  console.log('====================================================');
  console.log('CC Tools initial panel password:');
  console.log(initialPassword);
  console.log('====================================================');
}

export async function verifyPassword(password) {
  const config = await readConfig();
  if (!config.auth.passwordHash || !config.auth.passwordSalt) return false;
  const candidate = hashPassword(password, config.auth.passwordSalt);
  return crypto.timingSafeEqual(
    Buffer.from(candidate.hash, 'hex'),
    Buffer.from(config.auth.passwordHash, 'hex')
  );
}

export async function changePassword(password) {
  const config = await readConfig();
  const auth = hashPassword(password);
  config.auth.passwordHash = auth.hash;
  config.auth.passwordSalt = auth.salt;
  await writeConfig(config);
}

export async function createSession(res, remember = false) {
  const ttl = remember ? REMEMBER_TTL_MS : SESSION_TTL_MS;
  const token = await createSignedSessionToken(Date.now() + ttl);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: remember ? ttl : undefined
  });
}

export function destroySession(req, res) {
  res.clearCookie(SESSION_COOKIE);
}

export async function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  const valid = token ? await verifySessionToken(token) : false;
  if (!valid) {
    return res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
  }
  next();
}

export async function requirePageAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  const valid = token ? await verifySessionToken(token) : false;
  if (!valid) {
    return res.redirect('/login.html');
  }
  next();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

async function createSignedSessionToken(expiresAt) {
  const payload = Buffer.from(JSON.stringify({
    exp: expiresAt,
    nonce: crypto.randomBytes(16).toString('base64url')
  })).toString('base64url');
  const signature = await sign(payload);
  return `${payload}.${signature}`;
}

async function verifySessionToken(token) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return false;
  const expected = await sign(payload);
  if (!safeEqual(signature, expected)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

async function sign(payload) {
  const config = await readConfig();
  const secret = `${config.auth.passwordHash}:${config.auth.passwordSalt}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
