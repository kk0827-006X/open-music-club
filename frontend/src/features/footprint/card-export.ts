// 只处理本站 React 组件生成的 SVG；固化变量后下载不再依赖网页样式。
export function serializeCardArtwork(svg: SVGSVGElement) {
  const theme = getComputedStyle(svg);
  const Serializer = svg.ownerDocument.defaultView?.XMLSerializer;
  if (!Serializer) throw new Error('当前环境不支持卡片下载');
  return new Serializer()
    .serializeToString(svg)
    .replace(/var\((--(?:fp-card-[\w-]+|paper|amber|ink|muted))\)/g, (_, token: string) =>
      theme.getPropertyValue(token).trim(),
    );
}

export async function downloadCardPng(svg: SVGSVGElement, title: string, signal?: AbortSignal) {
  const assertActive = () => {
    if (signal?.aborted) throw new DOMException('导出已取消', 'AbortError');
  };
  assertActive();
  const source = URL.createObjectURL(
    new Blob([serializeCardArtwork(svg)], { type: 'image/svg+xml;charset=utf-8' }),
  );
  let output: string | undefined;
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        image.onload = null;
        image.onerror = null;
        signal?.removeEventListener('abort', abort);
      };
      const abort = () => {
        cleanup();
        reject(new DOMException('导出已取消', 'AbortError'));
      };
      image.onload = () => {
        cleanup();
        resolve();
      };
      image.onerror = () => {
        cleanup();
        reject(new Error('卡片图像读取失败'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      image.src = source;
    });
    assertActive();
    const canvas = document.createElement('canvas');
    canvas.width = Number(svg.getAttribute('width')) * 2;
    canvas.height = Number(svg.getAttribute('height')) * 2;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前环境不支持图片导出');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    assertActive();
    if (!blob) throw new Error('卡片图片导出失败');
    output = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = output;
    link.download = `${title.replace(/[\\/:*?"<>|]/g, '_') || '音乐足迹'}.png`;
    link.click();
  } finally {
    URL.revokeObjectURL(source);
    if (output) URL.revokeObjectURL(output);
  }
}
