# Azeroth Survivors Cloud Save

[![tests](https://github.com/luyang950/azeroth-survivors-cloud-save/actions/workflows/test.yml/badge.svg)](https://github.com/luyang950/azeroth-survivors-cloud-save/actions/workflows/test.yml)

**English** · [简体中文](README.zh-CN.md) · [Other languages ↓](#in-your-language)

A userscript that keeps your **Azeroth Survivors** progress in sync across browsers and devices. It stores the save in a private GitHub Gist that you own. There is no server and no extra account, only GitHub.

> **Unofficial fan tool.** It is not affiliated with Aethus (the game's developer) or Blizzard Entertainment. The game is free at its real page: **<https://wow.aethus.pl/>**. Copies of the game on other sites keep their own progress and are not supported.

## Features

- **Automatic**: when you open the game, it loads a newer save from the cloud. While you play, it uploads your progress.
- **No silent overwrites**: if this device and the cloud both have new progress, it asks you which one to keep.
- **Safe to undo**: before the cloud save replaces your local save, the script backs the local one up (it keeps the last 5). Every older cloud version stays in the Gist's revision history.
- **Fails safe**: if GitHub or the network is down, the game starts with your local save as usual.
- **15 languages**: the 14 languages the game offers, plus Traditional Chinese. It follows your browser language, and you can change it from the menu.
- **Private by default**: your token stays in the userscript manager's storage. The script only talks to `api.github.com` and `gist.githubusercontent.com`.

## Install

1. **Install a userscript manager.** [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
   In Chrome or Edge, also open the extension's details page and turn on **Allow User Scripts**.
2. **Install the script.** Open this link and confirm in your userscript manager:
   **[azeroth-survivors-cloud-save.user.js](https://raw.githubusercontent.com/luyang950/azeroth-survivors-cloud-save/main/azeroth-survivors-cloud-save.user.js)**
3. **Create a GitHub token** that can only touch Gists:
   - **Fine-grained token** (recommended): GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
     - Repository access: **Public repositories**. The script does not use any repository.
     - Permissions: switch to the **Account** tab → **Add permissions** → **Gists** → **Read and write**.
     - Set an expiration date.
   - Or a **classic token** with only the `gist` scope.
4. **Make a safety copy first.** In the game, open Options → Saves → **Export Save**.
5. **Connect.** Open <https://wow.aethus.pl/>, open the userscript manager's menu, choose **⚙️ Set GitHub token**, paste the token, and reload the page.
   The first device creates a secret Gist and uploads its save.
6. **On your other devices**, repeat steps 1, 2 and 5 with the same token. The script finds the Gist on its own and loads your progress.

Tip: give each device a name with **🏷️ Name this device**, so conflict messages show where a save came from.

## Menu

| Menu item | What it does |
| --- | --- |
| ⚙️ Set GitHub token | Saves the token, or removes it if you leave the field empty. |
| 🏷️ Name this device | Sets the name shown in conflict messages. |
| 📊 Sync status | Shows the Gist link, the save hashes, and whether sync is paused. |
| ⬆️ Upload local save now | Uploads right away. It still stops if another device has uploaded since your last sync. |
| ⬇️ Replace local save with cloud save | Backs up the local save, then reloads the page with the cloud save. |
| ⏫ Overwrite cloud save with local save | Uploads even if the cloud save has changed. |
| ⏸️ Pause / resume auto sync | Turns automatic syncing off or on. |
| 💾 Download a script backup | Downloads a backed-up save. Import it in the game with Options → Saves → Import Save. |
| 🌐 Language | Picks the script's language, or "Automatic" to follow the browser. |

## How it works

- The game keeps your progress in the browser's `localStorage` under `rogue.characters`. The value is the same text as the `.sav` file from **Export Save**, and the script syncs only that value.
- When the page opens, the script holds back the game's WebAssembly start-up for at most 30 seconds until the sync is done. That way a save pulled from the cloud is in place before the game reads it. If the sync takes longer, the game starts with the local save, and the script does not touch it during that session.
- To decide what to do, the script compares three hashes: the local save, the cloud save, and the version it last synced.

  | Local save | Cloud save | Result |
  | --- | --- | --- |
  | unchanged | changed | load the cloud save |
  | changed | unchanged | upload the local save |
  | changed | changed | ask you |

- While you play, it checks the save every 10 seconds. It uploads once the save has stayed the same for 15 seconds, at most once a minute, and tries again when you switch away from or close the tab.

## When both devices have new progress

This happens if you play on one device while the other is offline, or play on two devices at once. The script then shows two questions:

1. **OK** replaces the local save with the cloud save. The local save is backed up first.
2. Otherwise, **OK** overwrites the cloud with the local save. The old cloud version stays in the Gist history.
3. **Cancel** on both changes nothing, and automatic upload pauses until you open the page again.

If another device uploads while you are playing, the script stops uploading rather than overwrite it. Reload the page to choose.

## Recovering a save

- **A backup kept by the script**: choose **💾 Download a script backup**, then in the game use Options → Saves → **Import Save**.
- **An older cloud version**: open the Gist (the link is in **📊 Sync status**), click **Revisions**, open the version you want, and copy the `azeroth-survivors.sav` file into a `.sav` file. Then import that file in the game.
- **The game's own backups**: the game keeps an automatic backup every hour you play (the last 5). They are under Options → Saves → **Backups**.

## Privacy and security

- The token is stored in your userscript manager's storage, not in the game page's storage.
- A secret Gist is not listed on your profile, but anyone who has its link can read it. The save contains only game progress.
- Use a token that only has Gist access, and give it an expiration date. You can revoke it on GitHub at any time.

## Limits

- **Browser version only.** The Windows desktop build keeps its save in `%APPDATA%\wenilla-rogue\` (`characters.txt` and its backups). This location comes from reading the game files and has not been tested. To sync the desktop build, move that folder into a cloud-drive folder and link it back. Close the game first, then run in PowerShell:

  ```powershell
  New-Item -ItemType Directory -Force "$env:OneDrive\AzerothSurvivors" | Out-Null
  Move-Item "$env:APPDATA\wenilla-rogue" "$env:OneDrive\AzerothSurvivors\wenilla-rogue"
  New-Item -ItemType Junction -Path "$env:APPDATA\wenilla-rogue" -Target "$env:OneDrive\AzerothSurvivors\wenilla-rogue"
  ```

  On the other PCs, rename their own `wenilla-rogue` folder first, then run only the last line. Whether a browser save and a desktop save can replace each other has not been tested.
- **Play on one device at a time.** The script detects conflicts, but it cannot merge two saves.
- **The game may change.** This version was written against the game as of October 2026 (v0.115). If the game changes how it stores saves, the script needs an update.
- **Mobile is untested.** It should work with a userscript manager that supports `GM.*` APIs, such as the Userscripts app for Safari on iOS, or Firefox for Android.

## Development

```bash
node tests/sync.test.mjs
```

The test runs the userscript in Node with two simulated devices and a fake Gist server. It covers first upload, pulling, conflicts, network errors, the start-up gate, large saves and the translations. It needs Node 18 or newer and has no dependencies.

### Translations

All text is in the `STRINGS` table at the top of the script. To fix or add a language, copy the `en` block, translate the values, and keep every `{placeholder}`. `gamePath` should match the game's own menu labels. The tests check that every language has the same keys and placeholders.

## In your language

**简体中文** — 艾泽拉斯幸存者存档云同步：油猴脚本，通过你自己的私有 GitHub Gist 在多个浏览器和设备之间自动同步存档。[完整中文说明](README.zh-CN.md)。

**繁體中文** — 艾澤拉斯倖存者存檔雲端同步：使用者腳本，透過你自己的私人 GitHub Gist 在多個瀏覽器和裝置之間自動同步存檔。安裝步驟見上方 [Install](#install)。

**日本語** — Azeroth Survivors のセーブデータを、自分のプライベートな GitHub Gist を使ってブラウザやデバイス間で自動同期するユーザースクリプトです。インストール手順は上の [Install](#install) を参照してください。

**한국어** — 아제로스 서바이버즈 세이브 클라우드 동기화: 내 비공개 GitHub Gist를 이용해 여러 브라우저와 기기 사이에서 세이브를 자동으로 동기화하는 유저스크립트입니다. 설치 방법은 위의 [Install](#install)을 참고하세요.

**Deutsch** — Spielstand-Cloud-Sync für Azeroth Survivors: Ein Userscript, das deinen Spielstand über deinen eigenen privaten GitHub Gist automatisch zwischen Browsern und Geräten synchronisiert. Installation siehe [Install](#install).

**Français** — Synchronisation cloud des sauvegardes d’Azeroth Survivors : un userscript qui synchronise automatiquement votre sauvegarde entre navigateurs et appareils via votre propre Gist GitHub privé. Installation : voir [Install](#install).

**Español** — Sincronización en la nube de partidas de Azeroth Survivors: un userscript que sincroniza automáticamente tu partida entre navegadores y dispositivos mediante tu propio Gist privado de GitHub. Instalación: ver [Install](#install).

**Português (Brasil)** — Sincronização de saves na nuvem para Azeroth Survivors: um userscript que sincroniza automaticamente seu save entre navegadores e dispositivos usando seu próprio Gist privado do GitHub. Instalação: veja [Install](#install).

**Polski** — Synchronizacja zapisów Azeroth Survivors w chmurze: userscript, który automatycznie synchronizuje twój zapis gry między przeglądarkami i urządzeniami przez twój prywatny GitHub Gist. Instalacja: zobacz [Install](#install).

**Русский** — Облачная синхронизация сохранений Azeroth Survivors: юзерскрипт, который автоматически синхронизирует ваше сохранение между браузерами и устройствами через ваш личный приватный GitHub Gist. Установка: см. [Install](#install).

**Українська** — Хмарна синхронізація збережень Azeroth Survivors: юзерскрипт, який автоматично синхронізує ваше збереження між браузерами й пристроями через ваш власний приватний GitHub Gist. Встановлення: див. [Install](#install).

**Čeština** — Synchronizace uložených her Azeroth Survivors přes cloud: userscript, který automaticky synchronizuje vaši uloženou hru mezi prohlížeči a zařízeními přes váš vlastní soukromý GitHub Gist. Instalace: viz [Install](#install).

**Română** — Sincronizare în cloud a salvărilor Azeroth Survivors: un userscript care îți sincronizează automat salvarea între browsere și dispozitive prin propriul tău Gist GitHub privat. Instalare: vezi [Install](#install).

**Türkçe** — Azeroth Survivors kayıt dosyası bulut senkronizasyonu: kaydınızı kendi gizli GitHub Gist’iniz üzerinden tarayıcılar ve cihazlar arasında otomatik olarak senkronize eden bir kullanıcı betiği. Kurulum için [Install](#install) bölümüne bakın.

## License

[MIT](LICENSE)
