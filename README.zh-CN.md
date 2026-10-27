# 艾泽拉斯幸存者 存档云同步（Azeroth Survivors Cloud Save）

[English](README.md) · **简体中文**

一个油猴脚本，让你的**艾泽拉斯幸存者（Azeroth Survivors）**存档在多个浏览器和设备之间自动同步。存档放在你自己账号下的私有 GitHub Gist 里，不需要服务器，除了 GitHub 也不用注册别的账号。

> **非官方工具。** 与游戏开发者 Aethus、暴雪娱乐均无关。游戏在官方页面免费游玩：**<https://wow.aethus.pl/>**。其他网站上的游戏副本有各自独立的进度，本脚本不支持。

## 功能

- **自动同步**：打开游戏时，如果云端有更新的存档就先载入；玩的过程中自动上传进度。
- **不会悄悄覆盖**：本机和云端都有新进度时，会弹窗让你选保留哪一份。
- **可以反悔**：云端存档覆盖本机前，脚本会先备份本机存档（保留最近 5 份）；云端的每个旧版本都留在 Gist 的修订历史里。
- **出错不影响游戏**：GitHub 或网络出问题时，游戏照常用本机存档启动。
- **15 种语言**：覆盖游戏支持的 14 种语言，外加繁体中文。默认跟随浏览器语言，也可以在菜单里切换。
- **隐私**：Token 只存在油猴扩展自己的存储里，脚本只访问 `api.github.com` 和 `gist.githubusercontent.com`。

## 安装

1. **装油猴扩展**：[Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)。
   Chrome、Edge 还需要到扩展详情页打开“**允许用户脚本**”。
2. **装脚本**：打开下面的链接，在油猴里确认安装。
   **[azeroth-survivors-cloud-save.user.js](https://raw.githubusercontent.com/luyang950/azeroth-survivors-cloud-save/main/azeroth-survivors-cloud-save.user.js)**
3. **创建只能访问 Gist 的 GitHub Token**：
   - **Fine-grained token**（推荐）：GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token。
     - Repository access 选 **Public repositories**，脚本用不到任何仓库。
     - Permissions 区域先切到左侧的 **Account** 标签，再点 **Add permissions** → 勾选 **Gists** → 改成 **Read and write**。
     - 设一个过期时间。
   - 也可以用 **classic token**，scope 只勾 `gist`。
4. **先手动备份一次**：在游戏里打开 选项 → 存档 → **导出存档**。
5. **连接**：打开 <https://wow.aethus.pl/>，在油猴菜单里点“**⚙️ 设置 GitHub Token**”，粘贴 Token，然后刷新页面。
   第一台设备会新建一个私有 Gist，并上传当前存档。
6. **其他设备**：重复第 1、2、5 步，用同一个 Token。脚本会自动找到那个 Gist 并载入进度。

建议用“**🏷️ 设置本设备名称**”给每台设备起个名字，存档冲突时就能看出存档来自哪台。

## 菜单

| 菜单项 | 作用 |
| --- | --- |
| ⚙️ 设置 GitHub Token | 保存 Token；留空则清除。 |
| 🏷️ 设置本设备名称 | 设置冲突提示里显示的设备名。 |
| 📊 同步状态 | 查看 Gist 链接、存档 hash、是否暂停。 |
| ⬆️ 立即上传本机存档 | 马上上传。如果上次同步后有其他设备上传过，仍会停下不覆盖。 |
| ⬇️ 用云端存档覆盖本机 | 先备份本机存档，再刷新页面载入云端存档。 |
| ⏫ 用本机存档覆盖云端 | 不管云端有没有变化，都用本机存档上传覆盖。 |
| ⏸️ 暂停 / 恢复自动同步 | 关闭或打开自动同步。 |
| 💾 下载脚本保留的备份 | 下载备份的存档，再在游戏里用 选项 → 存档 → 导入存档 恢复。 |
| 🌐 语言 / Language | 切换脚本语言，选“自动”则跟随浏览器。 |

## 工作原理

- 游戏把进度存在浏览器 `localStorage` 的 `rogue.characters` 里，内容和“导出存档”得到的 `.sav` 文件一样。脚本只同步这一项。
- 打开页面时，脚本会让游戏的 WebAssembly 启动等同步完成再继续，最多等 30 秒，保证云端存档在游戏读取之前就位。超过 30 秒，游戏就用本机存档启动，这一次脚本不再改动本机存档。
- 同步方向靠比较三份 hash 决定：本机存档、云端存档、上次同步时的版本。

  | 本机存档 | 云端存档 | 结果 |
  | --- | --- | --- |
  | 没变 | 变了 | 载入云端存档 |
  | 变了 | 没变 | 上传本机存档 |
  | 变了 | 变了 | 弹窗让你选 |

- 游戏过程中每 10 秒检查一次存档。存档 15 秒没再变化就上传，两次上传至少间隔 1 分钟；切走或关闭标签页时也会尝试上传。

## 两边都有新进度时

一台设备离线时在另一台玩，或者两台同时玩，就会出现这种情况。脚本会依次问你两个问题：

1. 点**确定**：用云端存档覆盖本机，本机存档会先备份。
2. 否则再问一次，点**确定**：用本机存档覆盖云端，云端旧版本仍留在 Gist 历史里。
3. 两次都点**取消**：什么都不改，自动上传暂停到下次打开页面。

如果你正在玩的时候另一台设备上传了存档，脚本会停止上传，不去覆盖它。刷新页面后再选。

## 恢复存档

- **脚本保留的备份**：点“**💾 下载脚本保留的备份**”，再在游戏里用 选项 → 存档 → **导入存档**。
- **云端的旧版本**：打开 Gist（链接在“📊 同步状态”里），点 **Revisions**，找到想要的版本，把 `azeroth-survivors.sav` 的内容另存成 `.sav` 文件，再在游戏里导入。
- **游戏自带的备份**：游戏每玩一小时自动备份一次，保留最近 5 份，在 选项 → 存档 → **备份** 里。

## 隐私与安全

- Token 存在油猴扩展自己的存储里，不在游戏页面的存储里。
- 私有（secret）Gist 不会出现在你的主页列表里，但拿到链接的人可以看到内容。存档里只有游戏进度。
- 请用只有 Gist 权限、设了过期时间的 Token，随时可以在 GitHub 上吊销。

## 限制

- **只支持网页版。** Windows 桌面版把存档放在 `%APPDATA%\wenilla-rogue\`（`characters.txt` 和它的备份）。这个位置是从游戏程序里读出来的，没有实测过。桌面版可以用“网盘文件夹 + 目录联接”的办法同步：先关掉游戏，再在 PowerShell 里执行：

  ```powershell
  New-Item -ItemType Directory -Force "$env:OneDrive\AzerothSurvivors" | Out-Null
  Move-Item "$env:APPDATA\wenilla-rogue" "$env:OneDrive\AzerothSurvivors\wenilla-rogue"
  New-Item -ItemType Junction -Path "$env:APPDATA\wenilla-rogue" -Target "$env:OneDrive\AzerothSurvivors\wenilla-rogue"
  ```

  其他电脑上先把本机的 `wenilla-rogue` 文件夹改名备份，再只执行最后一行。网页版和桌面版的存档能不能互相替换，还没有验证过。
- **同一时间只在一台设备上玩。** 脚本能发现冲突，但没法把两份存档合并。
- **游戏可能会变。** 当前版本基于 2026 年 10 月的游戏（v0.115）编写。如果游戏改了存档的存放方式，脚本需要跟着更新。
- **手机端没测过。** 理论上支持 `GM.*` API 的用户脚本管理器都能用，比如 iOS Safari 上的 Userscripts App，或者安卓上的 Firefox。

## 开发

```bash
node tests/sync.test.mjs
```

测试在 Node 里模拟两台设备和一个假的 Gist 服务器运行脚本，覆盖首次上传、拉取、冲突、网络错误、启动等待、大存档和翻译检查。需要 Node 18 以上，没有任何依赖。

### 翻译

所有文字都在脚本顶部的 `STRINGS` 表里。要修正或新增语言，复制 `en` 那一段，翻译各项的值，保留所有 `{占位符}`。`gamePath` 要和游戏菜单里的原文一致。测试会检查每种语言的 key 和占位符是否和英文一致。

## 许可证

[MIT](LICENSE)
