import type { CardStyle } from '../../services/music/footprint.ts';

const choices: [CardStyle, string][] = [
  ['auto', '自动推荐'],
  ['amber', '琥珀奶油'],
  ['rose', '玫瑰奶昔'],
  ['mint', '薄荷气泡'],
  ['sky', '月光蓝调'],
  ['lilac', '紫罗兰糖'],
  ['butter', '柠檬黄油'],
  ['peach', '蜜桃汽水'],
  ['paper', '素纸灰白'],
];

// 使用原生单选组提供键盘方向键操作，页面仅传递状态和保存动作。
export function CardStylePicker({
  value,
  disabled,
  onChange,
}: {
  value: CardStyle;
  disabled: boolean;
  onChange: (style: CardStyle) => void;
}) {
  return (
    <fieldset className="fp-style-picker" disabled={disabled}>
      <legend>卡片风格</legend>
      {choices.map(([id, name]) => (
        <label key={id}>
          <input
            type="radio"
            name="memory-card-style"
            value={id}
            checked={value === id}
            onChange={() => onChange(id)}
          />
          <span>{name}</span>
        </label>
      ))}
      <small>已有卡片换色后自动保存到服务器</small>
    </fieldset>
  );
}
