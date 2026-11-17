import { useState, type Dispatch, type SetStateAction } from 'react';
import type {
  CardStyle,
  MemoryCard,
  createFootprintClient,
} from '../../services/music/footprint.ts';

type Setter<T> = Dispatch<SetStateAction<T>>;
type Options = {
  api: ReturnType<typeof createFootprintClient>;
  preview: MemoryCard | null;
  setPreview: Setter<MemoryCard | null>;
  setCards: Setter<MemoryCard[]>;
  setCardTotal: Setter<number>;
  setSelected: Setter<number[]>;
  title: string;
  selected: number[];
  mutate: (
    action: (signal: AbortSignal) => Promise<unknown>,
    message: string,
    after?: () => void,
    refresh?: boolean,
  ) => Promise<void>;
};

// 写请求复用页面代数和取消机制；收到服务器确认后才更新卡面，失败保留原颜色。
export function useCardStyles(options: Options) {
  const { api, preview, setPreview, setCards, setCardTotal, setSelected, title, selected, mutate } =
    options;
  const [draft, setDraft] = useState<CardStyle>('auto');
  const value = preview?.data.style ?? (preview ? 'auto' : draft);
  const change = (style: CardStyle) => {
    if (!preview) {
      setDraft(style);
      return;
    }
    void mutate(
      async (signal) => {
        const card = await api.updateCardStyle(preview.id, style, signal);
        if (signal.aborted) return;
        setPreview((previous) => (previous?.id === card.id ? card : previous));
        setCards((previous) => previous.map((item) => (item.id === card.id ? card : item)));
      },
      '卡片风格已保存',
      undefined,
      false,
    );
  };
  const generate = () =>
    mutate(
      async (signal) => {
        const card = await api.createCard(
          title.trim() || '我的听歌回忆',
          selected,
          signal,
          preview ? value : draft,
        );
        if (signal.aborted) return;
        setPreview(card);
        setCards((previous) => [card, ...previous.filter((item) => item.id !== card.id)]);
        setCardTotal((total) => total + 1);
        setSelected([]);
      },
      '回忆卡片已生成',
      undefined,
      false,
    );
  return { value, change, generate };
}
