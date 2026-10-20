import { createHmac } from 'node:crypto';
import QRCode from 'qrcode';

export const COFFEE_COOLDOWN_MS = 30 * 60 * 1000;

export function isCoffeeCommand(text) {
  return /^coffee\s*$/i.test(text);
}

export function coffeeCooldownWarning(lastSentAt, now = Date.now()) {
  if (!Number.isSafeInteger(lastSentAt) || lastSentAt < 0) return null;
  const availableAt = lastSentAt + COFFEE_COOLDOWN_MS;
  if (now >= availableAt) return null;
  const formattedTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(availableAt);
  return `WARNING: Subscription may have been used less than 30 minutes ago, and won't work until: ${formattedTime}`;
}

export function coffeePayload(env = process.env, timestamp = Math.floor(Date.now() / 1000)) {
  const identifier = env.PRET_PUBLIC_ID?.trim();
  const key = env.PRET_QR_SIGNING_KEY?.trim();
  if (!identifier || !key) throw new Error('Coffee is not configured.');
  if (/[:\s]/u.test(identifier)) throw new Error('Invalid coffee configuration.');
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('Invalid timestamp.');
  const message = `${identifier}:${timestamp}`;
  const signature = createHmac('sha256', key).update(message, 'utf8').digest('hex');
  return `PR_${Buffer.from(`${message}:${signature}`, 'utf8').toString('base64')}`;
}

export async function coffeeImage(env = process.env) {
  return QRCode.toBuffer(coffeePayload(env), {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 4,
    scale: 8,
  });
}

export async function handleCoffee(send, env = process.env) {
  if (!env.PRET_PUBLIC_ID?.trim() || !env.PRET_QR_SIGNING_KEY?.trim()) {
    await send({ text: 'Coffee is not configured. Ask the bot owner to set it up.' });
    return false;
  }
  try {
    const image = await coffeeImage(env);
    await send({ image, caption: 'Pret Subscription QR code ☕' });
    return true;
  } catch {
    // Neither credentials nor the QR payload belong in logs or error replies.
    console.error('Coffee QR generation or send failed.');
    await send({ text: 'Could not send a coffee QR. Please try again.' });
    return false;
  }
}
