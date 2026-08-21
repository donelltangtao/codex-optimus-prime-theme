# codex擎天柱主题 v1

这是一个给 macOS Codex 桌面应用使用的非官方背景主题。它包含 24 张按本地
时间每小时自动轮换的擎天柱风格背景，并会随窗口放大、缩小和宽屏布局自动适配。
主题只调整视觉背景与原生面板透明度，不改变按钮位置、输入框尺寸和点击区域。

![codex擎天柱主题 v1 预览](assets/backgrounds/20.webp)

## 使用前确认

- 电脑是 macOS，Apple 芯片和 Intel 芯片均可。
- 已安装并能正常使用官方 Codex 或 ChatGPT 桌面应用。
- 已安装 Node.js 20.10 或更新版本。

## 下载与安装

1. 在 GitHub Release 下载
   `codex-optimus-prime-theme-v1.0.1-macos.zip` 并解压。
2. 双击 `Install Prime Knight Theme.command` 完成安装。
3. 双击 `Start Prime Knight Theme.command` 打开独立主题窗口。
4. 双击 `Verify Prime Knight Theme.command`，看到验证通过即可正常使用。

如果 macOS 第一次阻止打开下载的 `.command` 文件，请按住 Control 点击该
文件，选择“打开”，再确认一次。脚本不会修改官方应用安装包或系统签名。

## 恢复原生界面

双击 `Restore Native Codex.command`。它只会停止本主题自己启动的独立窗口
和守护进程，清除主题拥有的界面节点，然后重新打开未加主题参数的官方应用。
你的对话、项目和官方应用文件不会被删除。

## v1 包含与不包含

包含：

- 24 张 2560×1440 小时背景；
- 全窗口铺满与多尺寸自适应；
- 侧栏、底部输入框、输出内容/来源浮层、编辑卡片和代码块的可读性处理；
- 安装、启动、验证、恢复四个双击入口。

不包含：

- Prime Knight 宠物实验；
- 你的聊天截图、项目名称、运行日志或本机路径；
- 官方 Codex/ChatGPT 应用文件。

## 非官方同人声明

代码和原创文档采用 MIT License。24 张背景是非官方 AI 生成同人图，不属于
MIT 代码许可的单独复用范围。本项目与 OpenAI、Hasbro、Paramount 或其他权利
方没有隶属、赞助或认可关系，也不主张或授予 Codex、ChatGPT、Transformers、
Optimus Prime、电影造型、商标或角色形象的任何权利。

出现问题时请查看 [故障排查](docs/TROUBLESHOOTING.md)。

## v1.0.1 补丁内容

- 修复 Codex 与 ChatGPT 新建页模式切换、四张建议卡片和底部输入框的遮挡；
- 修复输出内容/来源浮层、写作卡片和滚动后代码块标题栏的剩余遮挡；
- 不改原生文字、按钮、尺寸、位置、点击区域和 24 张小时背景。
