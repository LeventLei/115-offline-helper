<h1 align="center">
  <img src="extension/icons/icon128.png" width="64" height="64" alt="logo"><br>
  115 Offline Helper<br>
  <sub>115 离线助手</sub>
</h1>

<p align="center">
  <strong>Detect magnet/ed2k links and push them to your 115.com cloud offline download with one click.</strong><br>
  自动检测 magnet/ed2k 链接，一键推送到 115 网盘离线下载。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/manifest-v3-blue" alt="Manifest V3">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License">
  <img src="https://img.shields.io/badge/version-1.0.0-orange" alt="Version">
</p>

---

## ✨ Features / 功能特性

- 🔍 **Auto-detect links / 自动检测链接** — Automatically detect magnet and ed2k links on any web page (opt-in)
- 📋 **Clipboard support / 剪贴板支持** — Paste links directly in the popup to push
- 📥 **One-click push / 一键推送** — Push links to 115.com offline download queue instantly
- 📁 **Custom save directory / 自定义保存路径** — Choose which 115 folder to save downloads to
- 🗑️ **Auto-delete small files / 自动删除小文件** — Automatically remove files under a specified size (e.g., ads)
- 📂 **Auto-organize videos / 自动整理视频** — Automatically move video files into named folders
- 📱 **QR code login / 扫码登录** — Log into 115.com directly from the extension popup
- 🌐 **Bilingual UI / 中英双语** — Interface supports both Chinese and English

## 📦 Installation / 安装方法

<!-- ### Chrome Web Store（审核通过后补充） -->

### Manual Install / 手动安装

1. **Download the source code / 下载源码**

   ```bash
   git clone https://github.com/gangz1o/115-offline-helper.git
   ```

   Or click the green **Code** button → **Download ZIP**, then unzip.

   或点击绿色 **Code** 按钮 → **Download ZIP**，然后解压。

2. **Open Chrome Extensions page / 打开扩展管理页面**

   Navigate to `chrome://extensions/` in your browser.

   在浏览器地址栏输入 `chrome://extensions/`。

3. **Enable Developer Mode / 开启开发者模式**

   Toggle the **Developer mode** switch in the top-right corner.

   打开右上角的 **开发者模式** 开关。

4. **Load the extension / 加载扩展**

   Click **Load unpacked** and select the `extension` folder from the downloaded project.

   点击 **加载已解压的扩展程序**，选择项目中的 `extension` 文件夹。

5. **Done! / 完成！**

   The extension icon will appear in your toolbar. Pin it for easy access.

   扩展图标会出现在工具栏中，建议点击 📌 固定。

> **💡 Tip:** To update, `git pull` and click the ↻ refresh button on the extension card.
>
> **💡 提示：** 更新时 `git pull` 拉取最新代码，然后在扩展页面点击 ↻ 刷新按钮即可。

## 🚀 Usage / 使用说明

### Quick Start / 快速开始

1. **Login / 登录** — Click the extension icon, then click **Scan to Login** to log into your 115.com account.
2. **Set save directory / 设置保存目录** — Choose a target folder from the dropdown on the Home tab, or add custom paths in Settings (format: `FolderName:CID`).
3. **Push links / 推送链接** — Two ways:
   - **Popup**: Paste magnet/ed2k links directly into the input box and click **Push**.
   - **Auto-detect**: Enable "Auto detect links" in Settings, and the extension will detect links on any webpage you visit, showing a confirmation dialog for one-click pushing.

### Settings / 设置

| Setting | Description |
|---------|-------------|
| Save directory list | Add folders with `Name:CID` format, one per line |
| Auto-detect links | Enable content script to detect links on all pages |
| Auto-delete small files | Remove files smaller than specified MB after download |
| Auto-organize videos | Move video files into folders based on filename |

## ❓ FAQ / 常见问题

**Q: How to find a folder's CID? / 如何获取文件夹 CID？**

> Open the folder in [115.com](https://115.com), look at the URL: `https://115.com/?cid=1234567` — the number after `cid=` is the CID.
>
> 在 115 网盘网页版打开目标文件夹，地址栏中 `cid=` 后面的数字即 CID。

**Q: "Not logged in" error? / 提示未登录？**

> Click the extension icon → **Scan to Login**, scan the QR code with the 115 mobile app.
>
> 点击扩展图标 → **扫码登录**，用 115 手机客户端扫码。

**Q: Auto-detect not working? / 自动检测不生效？**

> Make sure "Auto detect links" is enabled in Settings. The browser will ask for additional permissions — click Allow.
>
> 确保在设置中开启了"自动检测链接"，浏览器会请求额外权限，请点击允许。

## 🔒 Privacy / 隐私

- All data is stored locally in your browser via `chrome.storage.local`
- No user data is collected, transmitted, or shared with third parties
- The extension only communicates with `*.115.com` domains for its core functionality
- [Full Privacy Policy / 完整隐私政策](https://gangz1o.github.io/115-offline-helper/privacy-policy.html)

## 📄 License

[MIT License](LICENSE)
