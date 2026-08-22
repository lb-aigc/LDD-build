LDD 0.2.0 Windows x64 一键构建包
================================

使用方法
--------
1. 将整个 ZIP 解压到本地磁盘，建议路径简短，例如 D:\LDD-Build。
2. 确保系统盘或构建盘至少有 15 GB 可用空间。
3. 双击 Build-LDD.cmd。
4. 保持网络连接，等待窗口显示 Build completed successfully。
5. 构建结束后会自动打开 release 文件夹。

最终需要的文件
--------------
- release\LDD-Setup-0.2.0-x64.exe
  完整的 Windows 10/11 x64 安装程序，其他电脑只需要这个文件即可安装。

- release\deepseek-harness-0.1.1-rc.2-windows-x64.lddruntime
  后续单独升级 Harness 内核时使用，不是首次安装程序。

- release\checksums.sha256
  安装包、源码包和内核包的 SHA-256 校验值。

脚本会自动完成
--------------
- 检查 Windows x64 和剩余磁盘空间。
- 检查 Git；缺少时尝试通过 winget 安装 Git for Windows。
- 下载固定版本 Node 24.19.0，并验证 SHA-256。
- 准备固定版本 pnpm 11.7.0、FFmpeg 9.0.1 和 FFprobe。
- 使用 pnpm-lock.yaml 安装锁定依赖。
- 构建 DeepSeek Harness 内核、视频分析插件和 LDD 桌面端。
- 生成 NSIS EXE、离线内核包和校验文件。

注意事项
--------
- 构建过程需要网络，耗时取决于网速与电脑性能。
- 不要把 API Key 写入源码或构建目录。
- 若 Windows SmartScreen 提示未知发布者，这是因为内部版本没有购买代码签名证书；请仅使用自己构建并核验 SHA-256 的文件。
- 失败日志保存在 .build-logs 文件夹，可以把最新日志发给我排查。
- 构建产生的 node_modules、vendor\runtime-host、dist 和 release 可在不再需要重新构建时删除。
