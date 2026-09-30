import { browser } from '#imports';
import type { Target } from '../types';

/**
 * Popup → background protocol. The background worker owns the proxy; the
 * popup only asks. Connection state itself is published through
 * `connectionItem` in storage, so the UI just watches that.
 */
export type ProxyMessage =
  | { type: 'proxy:connect'; membershipId: string; target: Target }
  | { type: 'proxy:disconnect' };

export type ProxyReply = { ok: true } | { ok: false; error: string };

export async function sendProxyMessage(message: ProxyMessage): Promise<ProxyReply> {
  return (await browser.runtime.sendMessage(message)) as ProxyReply;
}

export function isProxyMessage(value: unknown): value is ProxyMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    (value as { type: string }).type.startsWith('proxy:')
  );
}
