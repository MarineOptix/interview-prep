/**
 * The speech layer: turns the interviewer's line into audio.
 * The voice never stops a rehearsal. When there is no audio, the page shows the text and reads it with the browser's own voice.
 */
import { synthesizeGemini } from './gemini-tts.js';
import { KEY } from './gemini.js';

// The longest line the interviewer says is a question with a short lead-in.
const MAX_CHARS = 1200;

/** 'gemini' or 'browser'. SPEECH_PROVIDER=browser turns synthesis off, e.g. on the free tier with its 10 requests a day. */
export function speechMode(env = process.env) {
  return env.SPEECH_PROVIDER === 'browser' || !env[KEY] ? 'browser' : 'gemini';
}

/**
 * Returns { audio: Buffer, mimeType }, or null when the browser should speak:
 * the mode is 'browser', the text is empty, the provider is over its limit, or synthesis failed.
 */
export async function synthesize(text, env = process.env, fetchImpl = fetch) {
  const line = typeof text === 'string' ? text.trim().slice(0, MAX_CHARS) : '';
  if (!line || speechMode(env) === 'browser') return null;
  try {
    return await synthesizeGemini(line, env, fetchImpl);
  } catch {
    // The attempts are already in the log, without the text of the line.
    console.error('[speech] falling back to the browser voice');
    return null;
  }
}
