import { attemptRememberedSessionLogin } from './browserManager.js';
import {
  automaticLoginDue,
  markAutomaticLoginAttempt,
  resumeAfterAuthenticatedLogin
} from './sessionHealth.js';
import { writeConfig } from './storage.js';

export async function attemptAutomaticSessionRecovery(config, options = {}) {
  const health = config.automationHealth || {};
  if (health.state !== 'paused' || health.reasonCode !== 'LOGIN_REQUIRED') {
    return { attempted: false, recovered: false, reason: 'SESSION_NOT_PAUSED' };
  }
  if (config.crealitySession?.autoLoginEnabled !== true) {
    return { attempted: false, recovered: false, reason: 'AUTO_LOGIN_DISABLED' };
  }

  const now = options.now instanceof Date ? options.now : new Date();
  if (options.force !== true && !automaticLoginDue(config, now)) {
    return { attempted: false, recovered: false, reason: 'RETRY_NOT_DUE' };
  }

  markAutomaticLoginAttempt(config, 'attempting', '', now);
  await writeConfig(config);
  try {
    const automatic = await attemptRememberedSessionLogin({
      expectedUserId: config.crealityProfile?.userId || ''
    });
    if (automatic.authenticated) {
      markAutomaticLoginAttempt(config, 'success', 'Sesión recordada restablecida.', now);
      resumeAfterAuthenticatedLogin(config, null, new Date(automatic.checkedAt || Date.now()));
      await writeConfig(config);
      return { ...automatic, attempted: true, recovered: true };
    }

    const message = automaticLoginFailureMessage(automatic);
    markAutomaticLoginAttempt(
      config,
      automatic.reason === 'MANUAL_LOGIN_REQUIRED' ? 'manual_required' : 'skipped',
      message,
      now
    );
    await writeConfig(config);
    return { ...automatic, attempted: automatic.attempted !== false, recovered: false, message };
  } catch (error) {
    const message = error?.message || String(error);
    markAutomaticLoginAttempt(config, 'error', message, now);
    await writeConfig(config);
    if (!['BROWSER_BUSY', 'SESSION_CHECK_UNAVAILABLE', 'CREALITY_SERVICE_UNAVAILABLE'].includes(error?.code)) {
      console.warn('[session] Falló el inicio de sesión automático:', message);
    }
    return {
      attempted: true,
      recovered: false,
      reason: error?.code || 'AUTO_LOGIN_ERROR',
      message
    };
  }
}

export function automaticLoginFailureMessage(result = {}) {
  if (result.message) return String(result.message);
  if (result.reason === 'LOGIN_IN_PROGRESS') {
    return 'Hay un inicio de sesión interactivo abierto; se volverá a comprobar automáticamente.';
  }
  if (result.reason === 'BROWSER_BUSY') {
    return 'El navegador estaba ocupado; se volverá a intentar automáticamente.';
  }
  if (result.reason === 'SESSION_CHECK_INCONCLUSIVE') {
    return 'Creality Cloud no permitió confirmar la sesión recuperada; se volverá a intentar automáticamente.';
  }
  return 'No se pudo recuperar la cuenta recordada; es necesario iniciar sesión manualmente.';
}

export function sessionClosedNotification(recovery = {}) {
  const retrying = ['BROWSER_BUSY', 'LOGIN_IN_PROGRESS', 'SESSION_CHECK_INCONCLUSIVE'].includes(recovery.reason);
  if (retrying) {
    return '⚠️ CC Tools: Sesión de Creality Cloud cerrada\nLas automatizaciones se han pausado temporalmente. CC Tools volverá a intentar el inicio de sesión automático.';
  }
  const detail = recovery.message ? `\nMotivo: ${recovery.message}` : '';
  return `⚠️ CC Tools: Sesión de Creality Cloud cerrada\nNo se pudo restablecer automáticamente.${detail}\nAbre CC Tools e inicia sesión para reanudar las automatizaciones.`;
}
