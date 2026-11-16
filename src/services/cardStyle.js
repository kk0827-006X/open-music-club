const CARD_STYLES = ['auto', 'amber', 'rose', 'mint', 'sky', 'lilac', 'butter', 'peach', 'paper'];
const isCardStyle = (value) => CARD_STYLES.includes(value);
// 自动推荐在保存时解析为具体风格，后续时区调整不会改变已保存卡面。
function resolveCardStyle(style, data, offset) {
  if (style !== 'auto') return style;
  const hours = data.tracks
    .map((track) => {
      const raw = track.playedAt.trim().replace(' ', 'T');
      const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`;
      return new Date(Date.parse(normalized) + offset * 60000).getUTCHours();
    })
    .filter(Number.isFinite);
  if (!hours.length) return 'amber';
  const average = hours.reduce((sum, hour) => sum + hour, 0) / hours.length;
  if (average >= 21 || average < 5) return 'sky';
  if (average < 10) return 'mint';
  if (average < 14) return 'butter';
  if (average < 17) return 'peach';
  return 'lilac';
}
module.exports = { isCardStyle, resolveCardStyle };
