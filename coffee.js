import { createHmac } from 'node:crypto';
import QRCode from 'qrcode';

export function isCoffeeCommand(text) {
  return /^coffee\s*$/i.test(text);
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
    return;
  }
  try {
    const image = await coffeeImage(env);
    await send({ image, caption: 'Fresh coffee QR ☕ Use now; send coffee again for a new code.' });
  } catch {
    // Neither credentials nor the QR payload belong in logs or error replies.
    console.error('Coffee QR generation or send failed.');
    await send({ text: 'Could not send a coffee QR. Please try again.' });
  }
}
