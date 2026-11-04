import { mkdtemp, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

const MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024;

export function createGifHandler({ apiKey, tempDir }) {
  async function searchGif(query) {
    const url = new URL('https://api.giphy.com/v1/gifs/search');
    url.search = new URLSearchParams({ api_key: apiKey, q: query, limit: '20' });
    let response;
    let result;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (response.ok) result = await response.json();
    } catch {
      throw new Error('Could not reach GIPHY. Please try again shortly.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('GIPHY rejected the API key. Ask the bot owner to check GIPHY_API_KEY.');
    }
    if (response.status === 429) {
      throw new Error('GIPHY rate limit reached. Please try again later.');
    }
    if (!response.ok || !Array.isArray(result?.data)) {
      throw new Error('GIPHY search failed. Please try again shortly.');
    }
    if (!result.data.length) {
      throw new Error('No GIFs found. Try a different search.');
    }
    const choices = result.data.slice(0, 10).map(gif => ({
      url: gif.images?.fixed_height?.mp4 || gif.images?.original?.mp4,
    })).filter(gif => gif.url);
    if (!choices.length) {
      throw new Error('No WhatsApp-compatible GIFs found. Try a different search.');
    }
    return choices[Math.floor(Math.random() * choices.length)];
  }

  async function downloadGif(url, destination) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok || !response.body) throw new Error('Download failed');
      if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) {
        await response.body.cancel();
        throw new Error('Too large');
      }
      await pipeline(response.body, async function* (source) {
        let bytes = 0;
        for await (const chunk of source) {
          bytes += chunk.length;
          if (bytes > MAX_DOWNLOAD_BYTES) throw new Error('Too large');
          yield chunk;
        }
        if (!bytes) throw new Error('Empty download');
      }, createWriteStream(destination));
    } catch {
      throw new Error('Could not download that GIF (it may be too large). Please try again.');
    }
  }

  return async function handleGif(query, sendBotMessage) {
    const reply = text => sendBotMessage({ text });
    if (!query) {
      await reply('Usage: gif <search>');
      return;
    }
    if ([...query].length > 50) {
      await reply('Please keep your GIF search to 50 characters or fewer.');
      return;
    }

    console.log('GIF request received.');
    let requestDir;
    try {
      const gif = await searchGif(query);
      requestDir = await mkdtemp(join(tempDir, 'gif-'));
      const filename = join(requestDir, 'animation.mp4');
      await downloadGif(gif.url, filename);
      try {
        await sendBotMessage({
          video: { url: filename },
          mimetype: 'video/mp4',
          gifPlayback: true,

          jpegThumbnail: Buffer.alloc(0),
        });
      } catch {
        throw new Error('Could not send the GIF to WhatsApp. Please try again.');
      }
      console.log('GIF sent.');
    } catch (error) {
      console.error('GIF request failed:', error.message);
      await reply(error.message);
    } finally {
      if (requestDir) await rm(requestDir, { recursive: true, force: true });
    }
  };
}
