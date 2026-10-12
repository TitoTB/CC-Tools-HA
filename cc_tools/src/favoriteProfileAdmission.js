import { normalizeFavoriteProfiles, parseFavoriteProfileUrl } from './favoriteProfiles.js';

// Dependencies are supplied by the server so the admission flow can be tested without a live account.
export function createFavoriteProfileHandler({ readConfig, writeConfig, readCrealityProfile,
  readFavoriteProfile, queueFavoriteProfileSync, appendRun }) {
  return async (req, res) => {
    const parsed = parseFavoriteProfileUrl(req.body?.url);
    if (!parsed) return res.status(400).json({ ok: false, error: 'FAVORITE_PROFILE_URL_INVALID' });
    try {
      let config = await readConfig();
      if (!config.crealityProfile?.userId) {
        config.crealityProfile = await readCrealityProfile();
        await writeConfig(config);
      }
      const ownUserId = String(config.crealityProfile?.userId || '');
      if (ownUserId === parsed.userId) {
        return res.status(400).json({ ok: false, error: 'FAVORITE_PROFILE_IS_OWN' });
      }
      if (normalizeFavoriteProfiles(config.crealityFavorites).some(profile => profile.userId === parsed.userId)) {
        return res.status(409).json({ ok: false, error: 'FAVORITE_PROFILE_DUPLICATE' });
      }

      // Only save after confirming at least one published design in the profile's own list.
      const profile = await readFavoriteProfile(parsed.profileUrl, { requireModels: true });
      config = await readConfig();
      if (String(config.crealityProfile?.userId || '') !== ownUserId) {
        return res.status(409).json({ ok: false, error: 'FAVORITE_PROFILE_ACCOUNT_CHANGED' });
      }
      const favorites = normalizeFavoriteProfiles(config.crealityFavorites);
      if (favorites.some(item => item.userId === parsed.userId)) {
        return res.status(409).json({ ok: false, error: 'FAVORITE_PROFILE_DUPLICATE' });
      }
      profile.indexStatus = 'pending';
      config.crealityFavorites = normalizeFavoriteProfiles([...favorites, profile]);
      await writeConfig(config);
      queueFavoriteProfileSync(profile, { full: true, source: 'manual' });
      return res.json({ ok: true, favorites: config.crealityFavorites });
    } catch (error) {
      if (['FAVORITE_PROFILE_NO_MODELS', 'FAVORITE_PROFILE_MODELS_UNCONFIRMED'].includes(error.code)) {
        const empty = error.code === 'FAVORITE_PROFILE_NO_MODELS';
        const timestamp = new Date().toISOString();
        try {
          await appendRun({ taskId: 'favoriteProfiles', source: 'manual', status: empty ? 'warning' : 'error',
            message: error.message, startedAt: timestamp, finishedAt: timestamp, screenshots: [],
            details: { profileAdmission: { code: error.code, url: parsed.profileUrl } } });
        } catch (logError) {
          console.error('[favorites] No se pudo registrar el aviso de alta:', logError.message);
          return res.status(500).json({ ok: false, error: 'FAVORITE_PROFILE_NOTICE_LOG_FAILED',
            profileUrl: parsed.profileUrl });
        }
        return res.status(empty ? 422 : 409).json({ ok: false, error: error.code, profileUrl: parsed.profileUrl });
      }
      return res.status(409).json({ ok: false, error: error.code || error.message || 'FAVORITE_PROFILE_UNAVAILABLE' });
    }
  };
}
