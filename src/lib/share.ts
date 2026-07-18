import { Platform, Share as RNShare } from 'react-native';
import * as Clipboard from 'expo-clipboard';

/**
 * Hand something to the phone's own share sheet, so it can go straight into
 * WhatsApp, iMessage, or wherever they actually talk.
 *
 * Reading a code aloud or copy-pasting it is the part people give up on, so the
 * invite is a LINK that carries the code with it: the person who taps it never
 * sees a code at all.
 *
 * Falls back to the clipboard where there is no share sheet (desktop browsers,
 * and any browser without the Web Share API).
 */
export type ShareOutcome = 'shared' | 'copied' | 'failed';

export async function shareOrCopy(message: string, url: string): Promise<ShareOutcome> {
  const text = `${message}\n${url}`;

  if (Platform.OS === 'web') {
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }) : null;
    if (nav?.share) {
      try {
        // `text` and `url` together: iOS shows the message and attaches the
        // link, Android apps generally concatenate them.
        await nav.share({ title: 'Ours', text: message, url });
        return 'shared';
      } catch (err) {
        // AbortError means they closed the sheet on purpose; anything else and
        // we quietly fall through to copying.
        if ((err as Error)?.name === 'AbortError') return 'failed';
      }
    }
    try {
      await Clipboard.setStringAsync(text);
      return 'copied';
    } catch {
      return 'failed';
    }
  }

  try {
    await RNShare.share({ message: text });
    return 'shared';
  } catch {
    try {
      await Clipboard.setStringAsync(text);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
}

/** The origin to build invite links from. Empty on native, where links are typed. */
export function appOrigin(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return '';
}

/**
 * The pairing invite. `?join=CODE` is picked up by the sign-up screen, which
 * joins the space automatically once the account exists, so the partner never
 * types a code.
 */
export function inviteLink(code: string): string {
  const origin = appOrigin();
  return origin ? `${origin}/sign-up?join=${encodeURIComponent(code)}` : `code ${code}`;
}

export function inviteMessage(fromName?: string | null): string {
  return fromName
    ? `${fromName} started a little space for the two of you on Ours. Come be the other half ♥`
    : 'Come be the other half of our little space on Ours ♥';
}
