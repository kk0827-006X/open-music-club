// 档案模型和封面使用本站静态资源，不依赖原项目的构建时清单。
export const assetUrl = (path: string) => {
  const key = path.replace(/^\//, "");
  return `${import.meta.env.BASE_URL}${key}`;
};
