import { api } from '@/lib/api';
import { MockProxyController, type ProxyController } from '@/lib/proxy/controller';
import { isProxyMessage, type ProxyMessage, type ProxyReply } from '@/lib/proxy/messages';
import { connectionItem, sessionItem, settingsItem } from '@/lib/storage';

const controller: ProxyController = new MockProxyController();

async function handle(message: ProxyMessage): Promise<ProxyReply> {
  if (message.type === 'proxy:disconnect') {
    await controller.clear();
    await connectionItem.setValue({ status: 'disconnected' });
    return { ok: true };
  }

  const { membershipId, target } = message;
  await connectionItem.setValue({ status: 'connecting', membershipId, target });
  try {
    api.useSession(await sessionItem.getValue());
    const [credentials, settings] = await Promise.all([api.credentials(membershipId), settingsItem.getValue()]);
    const { exitIp } = await controller.apply(credentials, target, settings);
    await connectionItem.setValue({
      status: 'connected',
      membershipId,
      target,
      exitIp,
      since: new Date().toISOString(),
    });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Could not connect';
    await connectionItem.setValue({ status: 'error', message: error });
    return { ok: false, error };
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isProxyMessage(message)) return;
    handle(message).then(sendResponse);
    return true; // keep the channel open for the async reply
  });

  // Signing out anywhere tears the proxy down.
  sessionItem.watch((session) => {
    if (!session) void handle({ type: 'proxy:disconnect' });
  });
});
