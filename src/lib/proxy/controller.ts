import type { ProxyCredentials, ProxySettings, Target } from '../types';

/**
 * Applies / clears the browser-level proxy. Runs in the background worker
 * only. The live implementation (chrome.proxy.settings + PAC script with the
 * bypass list, webRequest.onAuthRequired for credentials, and
 * privacy.network.webRTCIPHandlingPolicy) will implement this same interface.
 */
export interface ProxyController {
  apply(credentials: ProxyCredentials, target: Target, settings: ProxySettings): Promise<{ exitIp: string }>;
  clear(): Promise<void>;
}

/** Pretends to connect; returns a plausible exit IP for the chosen target. */
export class MockProxyController implements ProxyController {
  async apply(_credentials: ProxyCredentials, target: Target): Promise<{ exitIp: string }> {
    await new Promise((resolve) => setTimeout(resolve, 1100));
    if (target.kind === 'isp') return { exitIp: target.ip.ip };
    const octet = () => Math.floor(Math.random() * 254) + 1;
    return { exitIp: `192.0.2.${octet()}` };
  }

  async clear(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
