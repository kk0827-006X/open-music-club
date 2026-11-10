module.exports = {
  // 文件名由脚本通过 Git 的 NUL 分隔输出读取，不拼接进命令字符串。
  '*': () => 'node scripts/lint-staged-check.cjs',
};
