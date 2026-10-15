import { readConfig, writeConfig } from './storage.js';
import { resumeAfterAuthenticatedLogin } from './sessionHealth.js';
import { sendTelegram } from './telegram.js';

export async function confirmAuthenticatedSession(now = new Date()) {
  const config = await readConfig();
  const resumed = resumeAfterAuthenticatedLogin(config, null, now);
  await writeConfig(config);

  if (resumed && config.telegram?.enabled) {
    await sendTelegram(
      config,
      '✅ CC Tools: Sesión de Creality Cloud restablecida\nLas automatizaciones se han reanudado.'
    ).catch((error) => console.error('[telegram]', error.message));
  }

  return {
    authenticated: true,
    resumed,
    checkedAt: config.crealitySession.checkedAt
  };
}
