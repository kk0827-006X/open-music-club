import fs from 'node:fs';
import tsParser from '@typescript-eslint/parser';

const features = fs
  .readdirSync(new URL('./frontend/src/features/', import.meta.url), {
    withFileTypes: true,
  })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const exceptions = JSON.parse(
  fs.readFileSync(
    new URL('./tests/fixtures/frontend-import-exceptions.json', import.meta.url),
    'utf8',
  ),
);
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const restricted = (folders, allowed = []) => [
  'error',
  {
    patterns: [
      {
        regex: `^(?!${allowed.length ? `(?:${allowed.map(escape).join('|')})$` : '(?!)'}).*?(?:^|/)(?:${folders.map(escape).join('|')})(?:/|$)`,
        message: '请遵守现有分层；跨 feature 协作由 app 装配，公共契约放入 shared。',
      },
    ],
  },
];
const query = 'CallExpression[callee.type="MemberExpression"]';
// 属性值里的点不是 class；跳过完整的属性选择器和引号内容。
const classPattern = String.raw`^(?:\[[^\]]*\]|"[^"]*"|'[^']*'|[^.\["'])*\.[A-Za-z_-]`;
const classFragment = String.raw`\.[A-Za-z_-]`;
// 插值模板只对完整的单个带引号 data-* 属性放行，避免属性值里的点误报。
const attrTemplate = (quote) =>
  String.raw`[quasis.0.value.raw=/^\[data-[A-Za-z0-9_-]+=${quote}[^${quote}\[\]\\]*$/]` +
  String.raw`:has(> TemplateElement.quasis[tail=true][value.raw=/^[^${quote}\[\]\\]*${quote}\]$/])` +
  String.raw`:not(:has(> TemplateElement.quasis:not(:first-child):not([tail=true])[value.raw=/[${quote}\[\]\\]/]))`;
const attributeExceptions = `:not(${attrTemplate("'")}):not(${attrTemplate('"')})`;
const classQueries = ['name', 'value'].flatMap((property) => [
  {
    selector: `${query}[callee.property.${property}=/^(querySelector|querySelectorAll|closest|matches)$/] > Literal.arguments[value=/${classPattern}/]`,
    message: 'features 和 app 内禁止使用 class 选择器查询 DOM，请使用 ref 或专用 data-* 标记。',
  },
  {
    selector: `${query}[callee.property.${property}=/^(querySelector|querySelectorAll|closest|matches)$/] > TemplateLiteral.arguments[expressions.length>0]${attributeExceptions} > TemplateElement[value.raw=/${classFragment}/]`,
    message: 'features 和 app 内禁止拼接 class 选择器查询 DOM，请使用 ref 或专用 data-* 标记。',
  },
  {
    selector: `${query}[callee.property.${property}=/^(querySelector|querySelectorAll|closest|matches)$/] > TemplateLiteral.arguments[expressions.length=0] > TemplateElement[value.raw=/${classPattern}/]`,
    message: 'features 和 app 内禁止使用 class 选择器查询 DOM，请使用 ref 或专用 data-* 标记。',
  },
]);

export default [
  { ignores: ['vendor/**', 'node_modules/**', 'frontend/dist/**', 'artifacts/**', 'storage/**'] },
  {
    files: ['frontend/src/**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser, ecmaVersion: 'latest', sourceType: 'module' },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['frontend/src/{features,app}/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...classQueries] },
  },
  {
    files: ['frontend/src/{features,app}/**/*.tsx'],
    rules: { 'max-lines': ['warn', { max: 400, skipBlankLines: false, skipComments: false }] },
  },
  ...features.map((feature) => ({
    files: [`frontend/src/features/${feature}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': restricted(['app', ...features.filter((name) => name !== feature)]),
    },
  })),
  ...Object.entries(exceptions).map(([file, allowed]) => ({
    files: [`frontend/src/${file}`],
    rules: {
      'no-restricted-imports': restricted(
        ['app', ...features.filter((name) => name !== file.split('/')[1])],
        allowed,
      ),
    },
  })),
  {
    files: ['frontend/src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restricted([
        'app',
        'features',
        'services',
        'graphics',
        'rhine',
        'rhine-motion',
      ]),
    },
  },
  {
    files: ['frontend/src/services/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': restricted(['app', 'features']) },
  },
  {
    files: ['frontend/src/{graphics,rhine,rhine-motion}/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': restricted(['app', 'features', 'services']) },
  },
];
