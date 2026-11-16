// 服务端与前端共用静态部件词表，不依赖前端组件或运行时。
const catalog = require('../../frontend/src/shared/avatar-catalog.json');
const { createAvatarStudioRepository } = require('../db/avatarStudio');
const SLOTS = ['body', 'head', 'top', 'bottom', 'shoes', 'accessory'];
const OUTFIT_LIMIT = 50;

class AvatarStudioError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function validateConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = [...SLOTS, 'theme', 'skin', 'hair'];
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    return null;
  if (
    SLOTS.some(
      (slot) =>
        value[slot] !== null && !catalog.parts[slot].some((part) => part.id === value[slot]),
    )
  )
    return null;
  if (
    !catalog.themes.some((item) => item.id === value.theme) ||
    !catalog.skins.some((item) => item.id === value.skin) ||
    !catalog.hair.some((item) => item.id === value.hair)
  )
    return null;
  // 只保存目录中已有的标识，不接收客户端 SVG、HTML 或任意颜色代码。
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

const toOutfit = (row) => ({
  id: row.id,
  name: row.name,
  config: JSON.parse(row.config_json),
  current: Boolean(row.is_current),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

function createAvatarStudioService(database) {
  const repository = createAvatarStudioRepository(database);
  function requireOwn(userId, id) {
    const row = repository.find(userId, id);
    if (!row) throw new AvatarStudioError(404, '形象不存在');
    return row;
  }
  return {
    list: (userId) => repository.list(userId).map(toOutfit),
    create: (userId, name, config) =>
      repository.transaction(() => {
        if (repository.count(userId) >= OUTFIT_LIMIT)
          throw new AvatarStudioError(409, '最多保存 50 个形象，请先删除不再需要的形象');
        const id = repository.add(userId, name, config);
        return toOutfit(requireOwn(userId, id));
      }),
    rename: (userId, id, name) => {
      requireOwn(userId, id);
      repository.rename(userId, id, name);
      return toOutfit(requireOwn(userId, id));
    },
    remove: (userId, id) => {
      requireOwn(userId, id);
      repository.remove(userId, id);
    },
    select: (userId, id) =>
      repository.transaction(() => {
        requireOwn(userId, id);
        repository.select(userId, id);
        return toOutfit(requireOwn(userId, id));
      }),
  };
}

module.exports = { createAvatarStudioService, validateConfig, AvatarStudioError, OUTFIT_LIMIT };
