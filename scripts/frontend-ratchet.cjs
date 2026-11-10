const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const MAX_LINES = 400;
const countLines = (source) =>
  source ? source.split(/\r\n|\r|\n/u).length - Number(/(?:\r\n|\r|\n)$/.test(source)) : 0;
function trackedFrontendFiles(projectRoot = root) {
  if (process.env.OMC_STAGED_CHECK !== '1') return null;
  return new Set(
    execFileSync('git', ['ls-files', '-z', '--', 'frontend/src'], {
      cwd: projectRoot,
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean)
      .map((file) => path.join(projectRoot, file)),
  );
}

function frontendSizes(projectRoot = root) {
  const sizes = {};
  const tracked = trackedFrontendFiles(projectRoot);
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.tsx?$/.test(entry.name) && (!tracked || tracked.has(file))) {
        sizes[path.relative(path.join(projectRoot, 'frontend/src'), file)] = countLines(
          fs.readFileSync(file, 'utf8'),
        );
      }
    }
  };
  for (const folder of ['features', 'app']) walk(path.join(projectRoot, 'frontend/src', folder));
  return sizes;
}

// 本地比较 HEAD；CI 显式比较 PR 基线或推送前提交，不能把当前提交当成旧上限。
function baselineAtBase(file) {
  let ref = process.env.RATCHET_BASE_REF || 'HEAD';
  if (/^0+$/.test(ref)) ref = 'HEAD^';
  execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: root, stdio: 'pipe' });
  const existing = spawnSync('git', ['cat-file', '-e', `${ref}:${file}`], {
    cwd: root,
    stdio: 'pipe',
  });
  if (existing.status !== 0) return null; // 首次引入白名单时，基准提交尚无这个文件。
  return JSON.parse(
    execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8' }),
  );
}

function sizeViolations(sizes, whitelist, previous) {
  const errors = [];
  for (const [file, lines] of Object.entries(sizes)) {
    const cap = whitelist[file];
    if (lines > MAX_LINES && cap === undefined)
      errors.push(`${file}：新超限文件 ${lines} 行，禁止新增白名单`);
    if (cap !== undefined && lines !== cap)
      errors.push(`${file}：当前 ${lines} 行，上限 ${cap}；缩小时同步降低上限`);
  }
  for (const [file, cap] of Object.entries(whitelist)) {
    if (!Number.isInteger(cap) || cap <= MAX_LINES)
      errors.push(`${file}：已达标文件必须移出白名单`);
    if (sizes[file] === undefined) errors.push(`${file}：已删除文件必须移出白名单`);
    if (previous && (previous[file] === undefined || cap > previous[file]))
      errors.push(`${file}：白名单和上限只许减少`);
  }
  return errors;
}

module.exports = {
  MAX_LINES,
  countLines,
  frontendSizes,
  trackedFrontendFiles,
  baselineAtBase,
  sizeViolations,
};
