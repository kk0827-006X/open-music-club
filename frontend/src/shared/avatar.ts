export type AvatarSlot = 'body' | 'head' | 'top' | 'bottom' | 'shoes' | 'accessory';
export type AvatarConfig = Record<AvatarSlot, string | null> & {
  theme: string;
  skin: string;
  hair: string;
};
export type AvatarOutfit = {
  id: number;
  name: string;
  config: AvatarConfig;
  current: boolean;
  createdAt: string;
  updatedAt: string;
};
export type AvatarSession = { viewerId: number; context: string; outfits: AvatarOutfit[] };
import catalog from './avatar-catalog.json';

export function isAvatarSession(value: unknown): value is AvatarSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<AvatarSession>;
  return (
    Number.isSafeInteger(session.viewerId) &&
    Number(session.viewerId) > 0 &&
    typeof session.context === 'string' &&
    session.context.length > 0 &&
    session.context.length <= 128 &&
    Array.isArray(session.outfits) &&
    session.outfits.length <= 50 &&
    session.outfits.every((item) => {
      if (
        !item ||
        typeof item !== 'object' ||
        !Number.isSafeInteger(item.id) ||
        item.id <= 0 ||
        typeof item.name !== 'string' ||
        item.name.length > 40 ||
        typeof item.current !== 'boolean' ||
        typeof item.createdAt !== 'string' ||
        typeof item.updatedAt !== 'string' ||
        !item.config ||
        typeof item.config !== 'object'
      )
        return false;
      const config = item.config;
      return (
        (Object.keys(catalog.parts) as AvatarSlot[]).every(
          (slot) =>
            config[slot] === null || catalog.parts[slot].some((part) => part.id === config[slot]),
        ) &&
        catalog.themes.some((theme) => theme.id === config.theme) &&
        catalog.skins.some((skin) => skin.id === config.skin) &&
        catalog.hair.some((hair) => hair.id === config.hair)
      );
    })
  );
}
