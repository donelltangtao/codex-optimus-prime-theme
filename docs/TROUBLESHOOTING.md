# codex擎天柱主题 v1 故障排查

## 双击文件后提示无法打开

按住 Control 点击对应的 `.command` 文件，选择“打开”，再确认一次。请只从
本仓库的正式 Release 下载，并先核对 Release 页面公布的 SHA-256。

## 提示需要 Node.js 20.10 或更新版本

安装当前受支持的 Node.js LTS，然后重新双击安装入口。安装脚本会在修改任何
主题文件或启动独立窗口前检查版本。

## 提示官方应用签名不正确

主题只接受 bundle id 为 `com.openai.codex`、由 OpenAI 正式签名并通过
macOS Gatekeeper 的应用。请从官方渠道重新安装 Codex/ChatGPT 桌面应用；不要
为了使用主题关闭签名检查，也不要修改应用包。

## 提示主题已经运行

直接使用已打开的独立主题窗口即可。如果窗口状态异常，先双击
`Restore Native Codex.command`，确认官方界面重新打开，再双击
`Start Prime Knight Theme.command`。

## 背景没有显示或某个区域仍是完全不透明

先双击 `Verify Prime Knight Theme.command`。如果验证失败，依次执行：

1. `Restore Native Codex.command`
2. `Install Prime Knight Theme.command`
3. `Start Prime Knight Theme.command`
4. `Verify Prime Knight Theme.command`

Codex 更新界面结构后，旧版本主题可能不再匹配；请检查 GitHub Release 是否
有更新版本，不要自行删除或替换官方应用内文件。

## 恢复入口报告失败

不要手动强制结束不确定的 Codex 进程。再次双击
`Restore Native Codex.command`；如果仍失败，请保留终端里显示的错误信息，
在 GitHub Issue 中只粘贴错误文字，不要上传聊天截图、项目内容、token 或密钥。

## 主题使用独立窗口的原因

主题通过只监听本机 `127.0.0.1` 的调试接口注入可撤销样式，并使用独立用户
资料目录，避免修改官方应用包、签名和原生进程。恢复入口会精确核对进程身份，
只停止由主题启动的窗口。
