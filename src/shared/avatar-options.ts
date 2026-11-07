/**
 * The avatar a player picks at character creation.
 *
 * **Ids only**, never free text and never an uploaded file: the client renders a
 * fixed set of shapes from these numbers, so there is no image upload to moderate
 * and nothing to store but three small integers. Placeholder artwork; the ids are
 * the contract, and the drawing behind them can change without a migration.
 *
 * This file lives in `src/shared` because the client imports it too, and it is
 * safe to: static, non-secret, no server code behind it. The colour swatches are
 * here for the same reason, so the picker draws the same thing the game will.
 */
export const AVATAR_SKIN_TONES = [1, 2, 3, 4, 5, 6] as const;
export const AVATAR_HAIR_STYLES = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const AVATAR_OUTFITS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export type AvatarSkinTone = (typeof AVATAR_SKIN_TONES)[number];
export type AvatarHairStyle = (typeof AVATAR_HAIR_STYLES)[number];
export type AvatarOutfit = (typeof AVATAR_OUTFITS)[number];

export type Avatar = {
  skinTone: AvatarSkinTone;
  hair: AvatarHairStyle;
  outfit: AvatarOutfit;
};

export const DEFAULT_AVATAR: Avatar = { skinTone: 3, hair: 1, outfit: 1 };

/**
 * Swatch colours, placeholder values that stand in for the drawn figure. Chosen
 * to stay distinguishable against both a dark and a light page.
 */
export const AVATAR_SKIN_COLOURS: Record<AvatarSkinTone, string> = {
  1: '#3b2620',
  2: '#5a3a2b',
  3: '#7b4f34',
  4: '#9c6b45',
  5: '#bd8a5f',
  6: '#dcae86',
};

export const AVATAR_HAIR_COLOURS: Record<AvatarHairStyle, string> = {
  1: '#151515',
  2: '#241a15',
  3: '#3d2a1c',
  4: '#5b3a22',
  5: '#7a4a2b',
  6: '#d8b24a',
  7: '#8a3b2f',
  8: '#2f3f6b',
};

export const AVATAR_OUTFIT_COLOURS: Record<AvatarOutfit, string> = {
  1: '#2b5d8a',
  2: '#2f6b4f',
  3: '#7a2f4f',
  4: '#8a5a2b',
  5: '#4a4a4a',
  6: '#a33b32',
  7: '#3f5b8a',
  8: '#6b4a8a',
};
