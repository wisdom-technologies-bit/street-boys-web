/**
 * The avatar a player picks at character creation.
 *
 * **Ids only**, never free text and never an uploaded file: the client renders a
 * fixed set of shapes from these numbers, so there is no image upload to moderate
 * and nothing to store but three small integers. Placeholder artwork; the ids are
 * the contract, and the drawing behind them can change without a migration.
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
