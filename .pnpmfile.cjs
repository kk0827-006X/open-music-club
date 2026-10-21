// 网易云在本项目中是嵌入式服务，不运行它的独立二进制打包或热重载命令。
// 从实际安装图中移除两条未使用的开发依赖链，而不是忽略 braces 的安全告警。
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === '@neteasecloudmusicapienhanced/api' && pkg.devDependencies) {
        delete pkg.devDependencies.pkg
        delete pkg.devDependencies.nodemon
      }
      return pkg
    },
  },
}
