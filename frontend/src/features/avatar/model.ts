import catalog from '../../shared/avatar-catalog.json';
import type { AvatarConfig, AvatarSlot } from '../../shared/avatar.ts';
export type { AvatarConfig, AvatarOutfit, AvatarSession } from '../../shared/avatar.ts';

// 仅复用参考项目的静态像素图案与色板；交互、渲染和持久化由本站实现。
export { catalog };
export const slots = ['body', 'head', 'top', 'bottom', 'shoes', 'accessory'] as const;
export const displaySlots: Slot[] = ['body', 'bottom', 'shoes', 'top', 'head', 'accessory'];
export const slotEnglish: Record<Slot, string> = {
  body: 'BODY',
  bottom: 'BOTTOM',
  shoes: 'SHOES',
  top: 'TOP',
  head: 'HEAD',
  accessory: 'ACC',
};
export const slotDurations: Record<Slot, string> = {
  body: '01:18',
  bottom: '00:55',
  shoes: '00:32',
  top: '01:04',
  head: '00:48',
  accessory: '00:21',
};
export type Slot = AvatarSlot;
export type AvatarPart = {
  id: string;
  label: string;
  w: number;
  h: number;
  ox: number;
  oy: number;
  lines: string[];
};
export const slotNames: Record<Slot, string> = {
  body: '体型',
  head: '头部',
  top: '上装',
  bottom: '下装',
  shoes: '鞋子',
  accessory: '配饰',
};
export const defaultConfig: AvatarConfig = {
  theme: 'moss',
  skin: 'light',
  hair: 'ink',
  body: 'body-steve',
  head: 'head-short',
  top: 'top-tshirt',
  bottom: 'bottom-overall',
  shoes: 'shoes-sneaker',
  accessory: 'acc-glasses',
};

export function avatarColors(config: AvatarConfig) {
  const theme = catalog.themes.find((item) => item.id === config.theme) ?? catalog.themes[0];
  const skin = catalog.skins.find((item) => item.id === config.skin) ?? catalog.skins[0];
  const hair = catalog.hair.find((item) => item.id === config.hair) ?? catalog.hair[0];
  return {
    ...catalog.colors,
    P: theme.primary,
    D: theme.dark,
    M: theme.light,
    S: skin.color,
    m: skin.shadow,
    h: hair.color,
    H: hair.light,
    f: '#D49A8A',
  } as Record<string, string | null>;
}

export function avatarPixels(config: AvatarConfig, only?: AvatarPart) {
  const colors = avatarColors(config);
  const pixels = new Map<string, { x: number; y: number; fill: string }>();
  const ordered: Slot[] = ['body', 'bottom', 'shoes', 'top', 'head', 'accessory'];
  const parts = only
    ? [only]
    : ordered.map((slot) => catalog.parts[slot].find((part) => part.id === config[slot]));
  for (const part of parts) {
    if (!part) continue;
    part.lines.forEach((row, y) => {
      const expanded = row.replace(/(\d+)([^\d])/g, (_, count: string, symbol: string) =>
        symbol.repeat(Number(count)),
      );
      Array.from(expanded).forEach((symbol, x) => {
        const fill = colors[symbol],
          gx = x + part.ox,
          gy = y + part.oy;
        if (fill && gx >= 0 && gx < 30 && gy >= 0 && gy < 36)
          pixels.set(`${gx}:${gy}`, { x: gx * 8, y: gy * 8, fill });
      });
    });
  }
  return [...pixels.values()];
}

export function randomOutfit(
  config: AvatarConfig,
  presetId: string,
  locks: Slot[],
  keepColors: boolean,
  random = Math.random,
): AvatarConfig {
  const preset = catalog.presets.find((item) => item.id === presetId);
  const choose = (items: string[]) =>
    items[Math.min(items.length - 1, Math.floor(random() * items.length))];
  const next = { ...config };
  // 与 zyr 原版一致：预设搭配锁定头部时同时保留发色和肤色；完全随机只锁部件。
  for (const slot of slots) {
    if (locks.includes(slot)) continue;
    next[slot] =
      preset && slot === 'accessory' && random() < 0.15
        ? null
        : choose(preset?.[slot] ?? catalog.parts[slot].map((part) => part.id));
  }
  if (!preset || !locks.includes('head')) {
    next.hair = choose(preset?.hair ?? catalog.hair.map((item) => item.id));
    next.skin = choose(catalog.skins.map((item) => item.id));
  }
  if (!keepColors) {
    next.theme = choose(preset?.themes ?? catalog.themes.map((item) => item.id));
  }
  return next;
}

export function partName(slot: Slot, id: string | null) {
  return catalog.parts[slot].find((part) => part.id === id)?.label ?? '尚未选择';
}
