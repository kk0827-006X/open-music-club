// 缺失、失败、取消、跳过均不能被解释为验收通过。
function businessPassed(result) {
  return result === 'success';
}

if (require.main === module) {
  const passed = businessPassed(process.env.BUSINESS_RESULT);
  console.log(passed ? '全部业务与安全检查通过' : '业务或安全检查未成功，禁止合并');
  process.exitCode = passed ? 0 : 1;
}

module.exports = { businessPassed };
