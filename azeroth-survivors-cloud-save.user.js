// ==UserScript==
// @name            Azeroth Survivors Cloud Save
// @name:zh-CN      艾泽拉斯幸存者 存档云同步
// @name:zh-TW      艾澤拉斯倖存者 存檔雲端同步
// @name:ja         Azeroth Survivors セーブデータ クラウド同期
// @name:ko         아제로스 서바이버즈 세이브 클라우드 동기화
// @name:de         Azeroth Survivors – Spielstand-Cloud-Sync
// @name:fr         Azeroth Survivors – synchronisation cloud des sauvegardes
// @name:es         Azeroth Survivors – partidas guardadas en la nube
// @name:pt-BR      Azeroth Survivors – saves na nuvem
// @name:pl         Azeroth Survivors – zapisy gry w chmurze
// @name:ru         Azeroth Survivors — облачные сохранения
// @name:uk         Azeroth Survivors — хмарні збереження
// @name:cs         Azeroth Survivors – uložené hry v cloudu
// @name:ro         Azeroth Survivors – salvări în cloud
// @name:tr         Azeroth Survivors – bulut kayıt senkronizasyonu
// @description         Unofficial. Syncs your Azeroth Survivors (wow.aethus.pl) save across browsers and devices through your own private GitHub Gist.
// @description:zh-CN   非官方。通过你自己的私有 GitHub Gist，在不同浏览器和设备之间同步艾泽拉斯幸存者（wow.aethus.pl）的存档。
// @description:zh-TW   非官方。透過你自己的私人 GitHub Gist，在不同瀏覽器和裝置之間同步艾澤拉斯倖存者（wow.aethus.pl）的存檔。
// @description:ja      非公式。自分のプライベートな GitHub Gist を使って、Azeroth Survivors（wow.aethus.pl）のセーブデータをブラウザやデバイス間で同期します。
// @description:ko      비공식. 내 비공개 GitHub Gist를 통해 아제로스 서바이버즈(wow.aethus.pl) 세이브를 브라우저와 기기 사이에서 동기화합니다.
// @description:de      Inoffiziell. Synchronisiert deinen Azeroth-Survivors-Spielstand (wow.aethus.pl) über deinen eigenen privaten GitHub Gist zwischen Browsern und Geräten.
// @description:fr      Non officiel. Synchronise votre sauvegarde d’Azeroth Survivors (wow.aethus.pl) entre navigateurs et appareils via votre propre Gist GitHub privé.
// @description:es      No oficial. Sincroniza tu partida de Azeroth Survivors (wow.aethus.pl) entre navegadores y dispositivos mediante tu propio Gist privado de GitHub.
// @description:pt-BR   Não oficial. Sincroniza seu save de Azeroth Survivors (wow.aethus.pl) entre navegadores e dispositivos usando seu próprio Gist privado do GitHub.
// @description:pl      Nieoficjalny. Synchronizuje zapis Azeroth Survivors (wow.aethus.pl) między przeglądarkami i urządzeniami przez twój prywatny GitHub Gist.
// @description:ru      Неофициально. Синхронизирует сохранение Azeroth Survivors (wow.aethus.pl) между браузерами и устройствами через ваш личный приватный GitHub Gist.
// @description:uk      Неофіційно. Синхронізує збереження Azeroth Survivors (wow.aethus.pl) між браузерами й пристроями через ваш власний приватний GitHub Gist.
// @description:cs      Neoficiální. Synchronizuje uloženou hru Azeroth Survivors (wow.aethus.pl) mezi prohlížeči a zařízeními přes váš vlastní soukromý GitHub Gist.
// @description:ro      Neoficial. Sincronizează salvarea Azeroth Survivors (wow.aethus.pl) între browsere și dispozitive prin propriul tău Gist GitHub privat.
// @description:tr      Resmî değildir. Azeroth Survivors (wow.aethus.pl) kaydınızı kendi gizli GitHub Gist’iniz üzerinden tarayıcılar ve cihazlar arasında senkronize eder.
// @namespace       https://github.com/luyang950/azeroth-survivors-cloud-save
// @version         0.2.0
// @author          luyang950
// @license         MIT
// @homepageURL     https://github.com/luyang950/azeroth-survivors-cloud-save
// @supportURL      https://github.com/luyang950/azeroth-survivors-cloud-save/issues
// @updateURL       https://raw.githubusercontent.com/luyang950/azeroth-survivors-cloud-save/main/azeroth-survivors-cloud-save.user.js
// @downloadURL     https://raw.githubusercontent.com/luyang950/azeroth-survivors-cloud-save/main/azeroth-survivors-cloud-save.user.js
// @match           https://wow.aethus.pl/*
// @run-at          document-start
// @noframes
// @grant           GM_getValue
// @grant           GM_setValue
// @grant           GM_xmlhttpRequest
// @grant           GM_registerMenuCommand
// @grant           GM.getValue
// @grant           GM.setValue
// @grant           GM.xmlHttpRequest
// @grant           GM.registerMenuCommand
// @connect         api.github.com
// @connect         gist.githubusercontent.com
// ==/UserScript==

/*
 * How it works
 * - The game keeps progress in localStorage under `rogue.characters`; the value is the same text
 *   as the .sav file from Options → Saves → Export Save. This script syncs only that value.
 * - At page start it puts a small gate into the page: the game's WebAssembly instantiation (after
 *   which it reads the save) waits until the sync is done, for at most gateTimeoutMs. So a save
 *   pulled from the cloud is in place before the game reads it.
 * - Direction is decided by a three-way compare: local save, cloud save, and the version last
 *   synced (base). If only one side changed, it syncs automatically. If both changed, it asks.
 * - A local save that gets replaced is backed up first (last 5, in the userscript's storage);
 *   older cloud versions stay in the Gist's revision history.
 */
(function () {
  'use strict';

  const TEST = typeof __AZSYNC_TEST__ === 'object' && __AZSYNC_TEST__ ? __AZSYNC_TEST__ : null;

  const SAVE_KEY = 'rogue.characters';
  const GIST_DESC = 'Azeroth Survivors save sync (azsync)';
  const FILE_SAVE = 'azeroth-survivors.sav';
  const FILE_META = 'azsync-meta.json';
  const API = 'https://api.github.com';
  const GATE_EVENT = 'azsync:release';
  const GATE_ATTR = 'data-azsync';

  const T = Object.assign(
    {
      gateTimeoutMs: 30000, // longest the sync may hold back the game's start
      pollMs: 10000, // how often to look for local save changes
      debounceMs: 15000, // upload once the save has been still for this long
      minPushGapMs: 60000, // minimum time between automatic uploads
      backups: 5, // replaced local saves kept by the script
    },
    (TEST && TEST.timing) || {}
  );

  const K = {
    token: 'token',
    gistId: 'gistId',
    base: 'baseHash',
    device: 'device',
    paused: 'paused',
    forcePull: 'forcePull',
    backups: 'backups',
    lang: 'language',
  };

  // ── Translations ──
  // The 14 languages the game itself offers, plus Traditional Chinese. `gamePath` uses the game's
  // own labels for Options → Saves → Import Save in each language.

  const STRINGS = {
    en: {
      name: 'English',
      title: 'Save sync',
      'menu.token': '⚙️ Set GitHub token',
      'menu.device': '🏷️ Name this device',
      'menu.status': '📊 Sync status',
      'menu.push': '⬆️ Upload local save now',
      'menu.pull': '⬇️ Replace local save with cloud save (reloads)',
      'menu.forcePush': '⏫ Overwrite cloud save with local save',
      'menu.pause': '⏸️ Pause / resume auto sync',
      'menu.backup': '💾 Download a script backup',
      'menu.language': '🌐 Language',
      'err.noToken': 'no GitHub token set',
      'err.network': 'network error',
      'err.timeout': 'request timed out',
      'err.badToken': 'the GitHub token is invalid or expired',
      'err.forbidden': 'GitHub refused the request ({status}: missing permission or rate limit)',
      'err.http': 'GitHub returned {status}',
      'err.raw': 'could not download the cloud save ({status})',
      'toast.needToken': 'No GitHub token yet. Open the userscript menu and choose "{menu}".',
      'toast.slow': 'The network was too slow, so the game started with the local save. Reload the page to sync again.',
      'toast.pulled': 'Loaded the cloud save ({from}).',
      'toast.skipped': 'Skipped this time. Auto upload is paused until the page is opened again.',
      'toast.failed': 'Sync failed: {error}. The game uses the local save as usual.',
      'toast.remoteChanged': 'Another device updated the cloud save ({from}). Auto upload is paused; reload the page to resolve it.',
      'toast.uploaded': 'Uploaded to the cloud.',
      'toast.uploadFailed': 'Upload failed, will retry ({error}).',
      'toast.tokenCleared': 'GitHub token removed.',
      'toast.tokenOk': 'Token works. Reload the page to start syncing.',
      'toast.tokenBad': 'Token check failed: {error}',
      'toast.deviceSet': 'Device name set to {name}.',
      'toast.paused': 'Auto sync paused.',
      'toast.resumed': 'Auto sync resumed. Reloading the page runs a full sync first.',
      'toast.languageSet': 'Language set to {name}. Reload the page to update the menu.',
      'halt.paused': 'paused by you',
      'halt.noToken': 'no GitHub token',
      'halt.slow': 'sync was too slow; the game started with the local save',
      'halt.skipped': 'skipped this time',
      'halt.remote': 'another device uploaded a newer cloud save',
      'conflict.ask': 'Both this device and the cloud have new changes, so the script cannot tell which one to keep.\n\nCloud save from: {from}\n\nOK: replace the local save with the cloud save (the local save is backed up first)\nCancel: choose next whether to overwrite the cloud with the local save',
      'conflict.push': "Overwrite the cloud save with this device's save?\n(Older cloud versions stay in the Gist revision history.)\n\nCancel: don't sync this time; auto upload pauses until the page is opened again",
      'prompt.token': 'Paste your GitHub token (it only needs Gists read and write). Leave it empty and press OK to remove the saved token.',
      'prompt.device': 'Name this device (shown when saves conflict):',
      'prompt.language': 'Choose a language (enter the number):\n{list}',
      'confirm.pull': 'Replace the local save with the cloud save? The page will reload; the current local save is backed up first.',
      'confirm.forcePush': "Overwrite the cloud save with this device's save? Older cloud versions stay in the Gist revision history.",
      'backup.none': 'No backups yet. The script keeps one only when the cloud save replaces the local save.',
      'backup.pick': 'Which backup do you want to download? Enter its number:\n{list}',
      'backup.done': 'Downloaded. In the game, open {path} and choose this file.',
      'backup.reason.pulled': 'before the cloud save replaced it',
      'status.device': 'Device: {v}',
      'status.token': 'Token: {v}',
      'status.gist': 'Gist: {v}',
      'status.local': 'Local save: {v}',
      'status.localValue': '{size} characters, hash {hash}',
      'status.base': 'Last synced version: {v}',
      'status.dirty': 'Changes not uploaded: {v}',
      'status.lastPush': 'Last upload: {v}',
      'status.state': 'State: {v}',
      'status.language': 'Language: {v}',
      'common.set': 'set',
      'common.unset': 'not set',
      'common.none': 'none',
      'common.yes': 'yes',
      'common.no': 'no',
      'common.ok': 'OK',
      'common.notYet': 'not yet this session',
      'common.auto': 'Automatic (browser language)',
      unknownDevice: 'unknown device',
      unknownTime: 'unknown time',
      from: '{device}, {time}',
      gamePath: 'Options → Saves → Import Save',
    },
    'zh-CN': {
      name: '简体中文',
      title: '存档同步',
      'menu.token': '⚙️ 设置 GitHub Token',
      'menu.device': '🏷️ 设置本设备名称',
      'menu.status': '📊 同步状态',
      'menu.push': '⬆️ 立即上传本机存档',
      'menu.pull': '⬇️ 用云端存档覆盖本机（会刷新页面）',
      'menu.forcePush': '⏫ 用本机存档覆盖云端',
      'menu.pause': '⏸️ 暂停 / 恢复自动同步',
      'menu.backup': '💾 下载脚本保留的备份',
      'menu.language': '🌐 语言 / Language',
      'err.noToken': '还没设置 GitHub Token',
      'err.network': '网络错误',
      'err.timeout': '请求超时',
      'err.badToken': 'GitHub Token 无效或已过期',
      'err.forbidden': 'GitHub 拒绝了请求（{status}，权限不足或触发限流）',
      'err.http': 'GitHub 返回 {status}',
      'err.raw': '读取云端存档失败（{status}）',
      'toast.needToken': '还没设置 GitHub Token，在油猴菜单里点“{menu}”。',
      'toast.slow': '网络太慢，游戏已经用本机存档启动了。刷新页面再同步一次。',
      'toast.pulled': '已载入云端存档（{from}）。',
      'toast.skipped': '这次没有同步，自动上传暂停到下次打开页面。',
      'toast.failed': '同步失败：{error}。游戏照常使用本机存档。',
      'toast.remoteChanged': '云端存档已被其他设备更新（{from}），自动上传已暂停。刷新页面来处理。',
      'toast.uploaded': '已上传到云端。',
      'toast.uploadFailed': '上传失败，稍后重试（{error}）。',
      'toast.tokenCleared': '已清除 GitHub Token。',
      'toast.tokenOk': 'Token 可用。刷新页面开始同步。',
      'toast.tokenBad': 'Token 检查失败：{error}',
      'toast.deviceSet': '设备名已设为：{name}',
      'toast.paused': '自动同步已暂停。',
      'toast.resumed': '自动同步已恢复，刷新页面会先做一次完整同步。',
      'toast.languageSet': '语言已设为 {name}，刷新页面后菜单会更新。',
      'halt.paused': '已手动暂停',
      'halt.noToken': '未设置 GitHub Token',
      'halt.slow': '同步太慢，游戏已用本机存档启动',
      'halt.skipped': '本次跳过了同步',
      'halt.remote': '云端有其他设备上传的新存档',
      'conflict.ask': '本机和云端的存档都改过，没法自动判断用哪个。\n\n云端存档来自：{from}\n\n确定：用云端存档覆盖本机（本机存档会先备份）\n取消：接着选是否用本机存档覆盖云端',
      'conflict.push': '用本机存档覆盖云端吗？\n（云端旧版本仍保留在 Gist 的修订历史里）\n\n取消：这次不同步，自动上传暂停到下次打开页面',
      'prompt.token': '粘贴 GitHub Token（只需要 Gists 读写权限）。留空并点确定会清除已保存的 Token。',
      'prompt.device': '给这台设备起个名字（存档冲突时会显示）：',
      'prompt.language': '选择语言（输入序号）：\n{list}',
      'confirm.pull': '用云端存档覆盖本机？页面会刷新，本机当前存档会先备份。',
      'confirm.forcePush': '用本机存档覆盖云端？云端旧版本仍保留在 Gist 的修订历史里。',
      'backup.none': '还没有备份。只有本机存档被云端覆盖时，脚本才会留一份备份。',
      'backup.pick': '下载哪一份备份？输入序号：\n{list}',
      'backup.done': '下载好了。在游戏里打开 {path}，选这个文件即可恢复。',
      'backup.reason.pulled': '被云端存档覆盖前',
      'status.device': '设备：{v}',
      'status.token': 'Token：{v}',
      'status.gist': 'Gist：{v}',
      'status.local': '本机存档：{v}',
      'status.localValue': '{size} 字符，hash {hash}',
      'status.base': '上次同步的版本：{v}',
      'status.dirty': '未上传的改动：{v}',
      'status.lastPush': '上次上传：{v}',
      'status.state': '状态：{v}',
      'status.language': '语言：{v}',
      'common.set': '已设置',
      'common.unset': '未设置',
      'common.none': '没有',
      'common.yes': '有',
      'common.no': '没有',
      'common.ok': '正常',
      'common.notYet': '本次还没有',
      'common.auto': '自动（跟随浏览器）',
      unknownDevice: '未知设备',
      unknownTime: '未知时间',
      from: '{device}，{time}',
      gamePath: '选项 → 存档 → 导入存档',
    },
    'zh-TW': {
      name: '繁體中文',
      title: '存檔同步',
      'menu.token': '⚙️ 設定 GitHub Token',
      'menu.device': '🏷️ 設定本裝置名稱',
      'menu.status': '📊 同步狀態',
      'menu.push': '⬆️ 立即上傳本機存檔',
      'menu.pull': '⬇️ 用雲端存檔覆蓋本機（會重新整理頁面）',
      'menu.forcePush': '⏫ 用本機存檔覆蓋雲端',
      'menu.pause': '⏸️ 暫停 / 恢復自動同步',
      'menu.backup': '💾 下載腳本保留的備份',
      'menu.language': '🌐 語言 / Language',
      'err.noToken': '尚未設定 GitHub Token',
      'err.network': '網路錯誤',
      'err.timeout': '請求逾時',
      'err.badToken': 'GitHub Token 無效或已過期',
      'err.forbidden': 'GitHub 拒絕了請求（{status}，權限不足或觸發速率限制）',
      'err.http': 'GitHub 回傳 {status}',
      'err.raw': '讀取雲端存檔失敗（{status}）',
      'toast.needToken': '尚未設定 GitHub Token，請在使用者腳本選單點選「{menu}」。',
      'toast.slow': '網路太慢，遊戲已經用本機存檔啟動了。重新整理頁面再同步一次。',
      'toast.pulled': '已載入雲端存檔（{from}）。',
      'toast.skipped': '這次沒有同步，自動上傳暫停到下次開啟頁面。',
      'toast.failed': '同步失敗：{error}。遊戲照常使用本機存檔。',
      'toast.remoteChanged': '雲端存檔已被其他裝置更新（{from}），自動上傳已暫停。重新整理頁面來處理。',
      'toast.uploaded': '已上傳到雲端。',
      'toast.uploadFailed': '上傳失敗，稍後重試（{error}）。',
      'toast.tokenCleared': '已清除 GitHub Token。',
      'toast.tokenOk': 'Token 可用。重新整理頁面開始同步。',
      'toast.tokenBad': 'Token 檢查失敗：{error}',
      'toast.deviceSet': '裝置名稱已設為：{name}',
      'toast.paused': '自動同步已暫停。',
      'toast.resumed': '自動同步已恢復，重新整理頁面會先做一次完整同步。',
      'toast.languageSet': '語言已設為 {name}，重新整理頁面後選單會更新。',
      'halt.paused': '已手動暫停',
      'halt.noToken': '未設定 GitHub Token',
      'halt.slow': '同步太慢，遊戲已用本機存檔啟動',
      'halt.skipped': '本次略過了同步',
      'halt.remote': '雲端有其他裝置上傳的新存檔',
      'conflict.ask': '本機和雲端的存檔都有變更，無法自動判斷要用哪一份。\n\n雲端存檔來自：{from}\n\n確定：用雲端存檔覆蓋本機（本機存檔會先備份）\n取消：接著選擇是否用本機存檔覆蓋雲端',
      'conflict.push': '要用本機存檔覆蓋雲端嗎？\n（雲端舊版本仍保留在 Gist 的修訂紀錄裡）\n\n取消：這次不同步，自動上傳暫停到下次開啟頁面',
      'prompt.token': '貼上 GitHub Token（只需要 Gists 讀寫權限）。留空並按確定會清除已儲存的 Token。',
      'prompt.device': '幫這台裝置取個名字（存檔衝突時會顯示）：',
      'prompt.language': '選擇語言（輸入編號）：\n{list}',
      'confirm.pull': '用雲端存檔覆蓋本機？頁面會重新整理，本機目前的存檔會先備份。',
      'confirm.forcePush': '用本機存檔覆蓋雲端？雲端舊版本仍保留在 Gist 的修訂紀錄裡。',
      'backup.none': '還沒有備份。只有本機存檔被雲端覆蓋時，腳本才會保留一份備份。',
      'backup.pick': '要下載哪一份備份？輸入編號：\n{list}',
      'backup.done': '下載完成。在遊戲裡開啟 {path}，選擇這個檔案即可還原。',
      'backup.reason.pulled': '被雲端存檔覆蓋前',
      'status.device': '裝置：{v}',
      'status.token': 'Token：{v}',
      'status.gist': 'Gist：{v}',
      'status.local': '本機存檔：{v}',
      'status.localValue': '{size} 字元，hash {hash}',
      'status.base': '上次同步的版本：{v}',
      'status.dirty': '未上傳的變更：{v}',
      'status.lastPush': '上次上傳：{v}',
      'status.state': '狀態：{v}',
      'status.language': '語言：{v}',
      'common.set': '已設定',
      'common.unset': '未設定',
      'common.none': '沒有',
      'common.yes': '有',
      'common.no': '沒有',
      'common.ok': '正常',
      'common.notYet': '本次尚未上傳',
      'common.auto': '自動（跟隨瀏覽器）',
      unknownDevice: '未知裝置',
      unknownTime: '未知時間',
      from: '{device}，{time}',
      gamePath: 'Options → Saves → Import Save（簡體介面：选项 → 存档 → 导入存档）',
    },
    ja: {
      name: '日本語',
      title: 'セーブ同期',
      'menu.token': '⚙️ GitHub トークンを設定',
      'menu.device': '🏷️ このデバイスの名前を設定',
      'menu.status': '📊 同期の状態',
      'menu.push': '⬆️ ローカルのセーブを今すぐアップロード',
      'menu.pull': '⬇️ クラウドのセーブでローカルを上書き（再読み込み）',
      'menu.forcePush': '⏫ ローカルのセーブでクラウドを上書き',
      'menu.pause': '⏸️ 自動同期を一時停止 / 再開',
      'menu.backup': '💾 スクリプトのバックアップをダウンロード',
      'menu.language': '🌐 言語 / Language',
      'err.noToken': 'GitHub トークンが未設定です',
      'err.network': 'ネットワークエラー',
      'err.timeout': 'リクエストがタイムアウトしました',
      'err.badToken': 'GitHub トークンが無効か期限切れです',
      'err.forbidden': 'GitHub にリクエストを拒否されました（{status}：権限不足またはレート制限）',
      'err.http': 'GitHub が {status} を返しました',
      'err.raw': 'クラウドのセーブを読み込めませんでした（{status}）',
      'toast.needToken': 'GitHub トークンがまだ設定されていません。ユーザースクリプトのメニューから「{menu}」を選んでください。',
      'toast.slow': '通信が遅かったため、ゲームはローカルのセーブで起動しました。ページを再読み込みすると再同期します。',
      'toast.pulled': 'クラウドのセーブを読み込みました（{from}）。',
      'toast.skipped': '今回は同期しませんでした。次にページを開くまで自動アップロードを停止します。',
      'toast.failed': '同期に失敗しました：{error}。ゲームはいつも通りローカルのセーブを使います。',
      'toast.remoteChanged': '別のデバイスがクラウドのセーブを更新しました（{from}）。自動アップロードを停止しました。ページを再読み込みして解決してください。',
      'toast.uploaded': 'クラウドにアップロードしました。',
      'toast.uploadFailed': 'アップロードに失敗しました。あとで再試行します（{error}）。',
      'toast.tokenCleared': 'GitHub トークンを削除しました。',
      'toast.tokenOk': 'トークンは有効です。ページを再読み込みすると同期を始めます。',
      'toast.tokenBad': 'トークンの確認に失敗しました：{error}',
      'toast.deviceSet': 'デバイス名を {name} に設定しました。',
      'toast.paused': '自動同期を一時停止しました。',
      'toast.resumed': '自動同期を再開しました。ページを再読み込みすると、まず完全な同期を行います。',
      'toast.languageSet': '言語を {name} に設定しました。ページを再読み込みするとメニューに反映されます。',
      'halt.paused': 'ユーザーが一時停止中',
      'halt.noToken': 'GitHub トークン未設定',
      'halt.slow': '同期が遅く、ゲームはローカルのセーブで起動',
      'halt.skipped': '今回は同期をスキップ',
      'halt.remote': '別のデバイスが新しいセーブをアップロード済み',
      'conflict.ask': 'このデバイスとクラウドの両方でセーブが変更されているため、どちらを残すか自動では判断できません。\n\nクラウドのセーブ：{from}\n\nOK：クラウドのセーブでローカルを上書き（ローカルのセーブは先にバックアップ）\nキャンセル：次に、ローカルのセーブでクラウドを上書きするか選択',
      'conflict.push': 'このデバイスのセーブでクラウドを上書きしますか？\n（クラウドの古いバージョンは Gist の履歴に残ります）\n\nキャンセル：今回は同期せず、次にページを開くまで自動アップロードを停止',
      'prompt.token': 'GitHub トークンを貼り付けてください（Gists の読み書き権限だけで十分です）。空欄のまま OK を押すと保存済みのトークンを削除します。',
      'prompt.device': 'このデバイスの名前（セーブが競合したときに表示）：',
      'prompt.language': '言語を選んでください（番号を入力）：\n{list}',
      'confirm.pull': 'クラウドのセーブでローカルを上書きしますか？ページが再読み込みされ、現在のローカルのセーブは先にバックアップされます。',
      'confirm.forcePush': 'このデバイスのセーブでクラウドを上書きしますか？クラウドの古いバージョンは Gist の履歴に残ります。',
      'backup.none': 'バックアップはまだありません。クラウドのセーブでローカルを上書きしたときだけ保存されます。',
      'backup.pick': 'どのバックアップをダウンロードしますか？番号を入力：\n{list}',
      'backup.done': 'ダウンロードしました。ゲームで {path} を開き、このファイルを選んでください。',
      'backup.reason.pulled': 'クラウドのセーブで上書きされる前',
      'status.device': 'デバイス：{v}',
      'status.token': 'トークン：{v}',
      'status.gist': 'Gist：{v}',
      'status.local': 'ローカルのセーブ：{v}',
      'status.localValue': '{size} 文字、hash {hash}',
      'status.base': '前回同期したバージョン：{v}',
      'status.dirty': '未アップロードの変更：{v}',
      'status.lastPush': '前回のアップロード：{v}',
      'status.state': '状態：{v}',
      'status.language': '言語：{v}',
      'common.set': '設定済み',
      'common.unset': '未設定',
      'common.none': 'なし',
      'common.yes': 'あり',
      'common.no': 'なし',
      'common.ok': '正常',
      'common.notYet': 'このセッションではまだ',
      'common.auto': '自動（ブラウザの言語）',
      unknownDevice: '不明なデバイス',
      unknownTime: '不明な時刻',
      from: '{device}、{time}',
      gamePath: 'オプション → セーブ → セーブをインポート',
    },
    ko: {
      name: '한국어',
      title: '세이브 동기화',
      'menu.token': '⚙️ GitHub 토큰 설정',
      'menu.device': '🏷️ 이 기기 이름 설정',
      'menu.status': '📊 동기화 상태',
      'menu.push': '⬆️ 로컬 세이브 지금 업로드',
      'menu.pull': '⬇️ 클라우드 세이브로 로컬 덮어쓰기 (새로고침)',
      'menu.forcePush': '⏫ 로컬 세이브로 클라우드 덮어쓰기',
      'menu.pause': '⏸️ 자동 동기화 일시정지 / 재개',
      'menu.backup': '💾 스크립트 백업 다운로드',
      'menu.language': '🌐 언어 / Language',
      'err.noToken': 'GitHub 토큰이 설정되지 않았습니다',
      'err.network': '네트워크 오류',
      'err.timeout': '요청 시간 초과',
      'err.badToken': 'GitHub 토큰이 잘못되었거나 만료되었습니다',
      'err.forbidden': 'GitHub이 요청을 거부했습니다 ({status}: 권한 부족 또는 요청 한도 초과)',
      'err.http': 'GitHub 응답 {status}',
      'err.raw': '클라우드 세이브를 불러오지 못했습니다 ({status})',
      'toast.needToken': 'GitHub 토큰이 아직 없습니다. 유저스크립트 메뉴에서 "{menu}"을(를) 선택하세요.',
      'toast.slow': '네트워크가 너무 느려서 게임이 로컬 세이브로 시작되었습니다. 페이지를 새로고침하면 다시 동기화합니다.',
      'toast.pulled': '클라우드 세이브를 불러왔습니다 ({from}).',
      'toast.skipped': '이번에는 동기화하지 않았습니다. 다음에 페이지를 열 때까지 자동 업로드를 멈춥니다.',
      'toast.failed': '동기화 실패: {error}. 게임은 평소처럼 로컬 세이브를 사용합니다.',
      'toast.remoteChanged': '다른 기기가 클라우드 세이브를 업데이트했습니다 ({from}). 자동 업로드를 멈췄습니다. 페이지를 새로고침해서 해결하세요.',
      'toast.uploaded': '클라우드에 업로드했습니다.',
      'toast.uploadFailed': '업로드 실패, 잠시 후 다시 시도합니다 ({error}).',
      'toast.tokenCleared': 'GitHub 토큰을 삭제했습니다.',
      'toast.tokenOk': '토큰이 정상입니다. 페이지를 새로고침하면 동기화를 시작합니다.',
      'toast.tokenBad': '토큰 확인 실패: {error}',
      'toast.deviceSet': '기기 이름을 {name}(으)로 설정했습니다.',
      'toast.paused': '자동 동기화를 일시정지했습니다.',
      'toast.resumed': '자동 동기화를 재개했습니다. 페이지를 새로고침하면 먼저 전체 동기화를 합니다.',
      'toast.languageSet': '언어를 {name}(으)로 설정했습니다. 페이지를 새로고침하면 메뉴에 반영됩니다.',
      'halt.paused': '사용자가 일시정지함',
      'halt.noToken': 'GitHub 토큰 없음',
      'halt.slow': '동기화가 느려 게임이 로컬 세이브로 시작됨',
      'halt.skipped': '이번에는 동기화를 건너뜀',
      'halt.remote': '다른 기기가 더 새로운 세이브를 업로드함',
      'conflict.ask': '이 기기와 클라우드 양쪽 모두 세이브가 바뀌어서 어느 쪽을 남길지 자동으로 판단할 수 없습니다.\n\n클라우드 세이브: {from}\n\n확인: 클라우드 세이브로 로컬을 덮어쓰기 (로컬 세이브는 먼저 백업)\n취소: 다음으로 로컬 세이브로 클라우드를 덮어쓸지 선택',
      'conflict.push': '이 기기의 세이브로 클라우드를 덮어쓸까요?\n(이전 클라우드 버전은 Gist 수정 기록에 남습니다.)\n\n취소: 이번에는 동기화하지 않고, 다음에 페이지를 열 때까지 자동 업로드를 멈춤',
      'prompt.token': 'GitHub 토큰을 붙여넣으세요 (Gists 읽기/쓰기 권한만 있으면 됩니다). 비워 두고 확인을 누르면 저장된 토큰을 삭제합니다.',
      'prompt.device': '이 기기의 이름 (세이브 충돌 시 표시):',
      'prompt.language': '언어를 선택하세요 (번호 입력):\n{list}',
      'confirm.pull': '클라우드 세이브로 로컬을 덮어쓸까요? 페이지가 새로고침되고, 현재 로컬 세이브는 먼저 백업됩니다.',
      'confirm.forcePush': '이 기기의 세이브로 클라우드를 덮어쓸까요? 이전 클라우드 버전은 Gist 수정 기록에 남습니다.',
      'backup.none': '아직 백업이 없습니다. 클라우드 세이브가 로컬 세이브를 덮어쓸 때만 백업을 남깁니다.',
      'backup.pick': '어떤 백업을 다운로드할까요? 번호를 입력하세요:\n{list}',
      'backup.done': '다운로드했습니다. 게임에서 {path}을(를) 열고 이 파일을 선택하세요.',
      'backup.reason.pulled': '클라우드 세이브로 덮어쓰기 전',
      'status.device': '기기: {v}',
      'status.token': '토큰: {v}',
      'status.gist': 'Gist: {v}',
      'status.local': '로컬 세이브: {v}',
      'status.localValue': '{size}자, hash {hash}',
      'status.base': '마지막 동기화 버전: {v}',
      'status.dirty': '업로드되지 않은 변경: {v}',
      'status.lastPush': '마지막 업로드: {v}',
      'status.state': '상태: {v}',
      'status.language': '언어: {v}',
      'common.set': '설정됨',
      'common.unset': '설정 안 됨',
      'common.none': '없음',
      'common.yes': '있음',
      'common.no': '없음',
      'common.ok': '정상',
      'common.notYet': '이번 세션에서는 아직 없음',
      'common.auto': '자동 (브라우저 언어)',
      unknownDevice: '알 수 없는 기기',
      unknownTime: '알 수 없는 시간',
      from: '{device}, {time}',
      gamePath: '설정 → 저장 → 저장 파일 가져오기',
    },
    de: {
      name: 'Deutsch',
      title: 'Spielstand-Sync',
      'menu.token': '⚙️ GitHub-Token festlegen',
      'menu.device': '🏷️ Gerätenamen festlegen',
      'menu.status': '📊 Sync-Status',
      'menu.push': '⬆️ Lokalen Spielstand jetzt hochladen',
      'menu.pull': '⬇️ Lokalen Spielstand durch Cloud-Spielstand ersetzen (lädt neu)',
      'menu.forcePush': '⏫ Cloud-Spielstand mit lokalem überschreiben',
      'menu.pause': '⏸️ Automatischen Sync pausieren / fortsetzen',
      'menu.backup': '💾 Backup des Skripts herunterladen',
      'menu.language': '🌐 Sprache / Language',
      'err.noToken': 'kein GitHub-Token festgelegt',
      'err.network': 'Netzwerkfehler',
      'err.timeout': 'Zeitüberschreitung der Anfrage',
      'err.badToken': 'das GitHub-Token ist ungültig oder abgelaufen',
      'err.forbidden': 'GitHub hat die Anfrage abgelehnt ({status}: fehlende Berechtigung oder Ratenlimit)',
      'err.http': 'GitHub antwortete mit {status}',
      'err.raw': 'Cloud-Spielstand konnte nicht geladen werden ({status})',
      'toast.needToken': 'Noch kein GitHub-Token. Öffne das Userscript-Menü und wähle „{menu}“.',
      'toast.slow': 'Das Netzwerk war zu langsam, daher startete das Spiel mit dem lokalen Spielstand. Lade die Seite neu, um erneut zu synchronisieren.',
      'toast.pulled': 'Cloud-Spielstand geladen ({from}).',
      'toast.skipped': 'Diesmal nicht synchronisiert. Der automatische Upload pausiert bis zum nächsten Öffnen der Seite.',
      'toast.failed': 'Synchronisierung fehlgeschlagen: {error}. Das Spiel nutzt wie gewohnt den lokalen Spielstand.',
      'toast.remoteChanged': 'Ein anderes Gerät hat den Cloud-Spielstand aktualisiert ({from}). Der automatische Upload ist pausiert; lade die Seite neu, um das zu klären.',
      'toast.uploaded': 'In die Cloud hochgeladen.',
      'toast.uploadFailed': 'Upload fehlgeschlagen, neuer Versuch folgt ({error}).',
      'toast.tokenCleared': 'GitHub-Token entfernt.',
      'toast.tokenOk': 'Token funktioniert. Lade die Seite neu, um mit der Synchronisierung zu beginnen.',
      'toast.tokenBad': 'Token-Prüfung fehlgeschlagen: {error}',
      'toast.deviceSet': 'Gerätename auf {name} gesetzt.',
      'toast.paused': 'Automatischer Sync pausiert.',
      'toast.resumed': 'Automatischer Sync fortgesetzt. Beim Neuladen der Seite wird zuerst vollständig synchronisiert.',
      'toast.languageSet': 'Sprache auf {name} gesetzt. Lade die Seite neu, um das Menü zu aktualisieren.',
      'halt.paused': 'von dir pausiert',
      'halt.noToken': 'kein GitHub-Token',
      'halt.slow': 'Sync war zu langsam; das Spiel startete mit dem lokalen Spielstand',
      'halt.skipped': 'diesmal übersprungen',
      'halt.remote': 'ein anderes Gerät hat einen neueren Cloud-Spielstand hochgeladen',
      'conflict.ask': 'Sowohl dieses Gerät als auch die Cloud haben neue Änderungen; das Skript kann nicht entscheiden, welcher Stand bleiben soll.\n\nCloud-Spielstand von: {from}\n\nOK: lokalen Spielstand durch den Cloud-Spielstand ersetzen (der lokale wird vorher gesichert)\nAbbrechen: als Nächstes wählen, ob die Cloud mit dem lokalen Spielstand überschrieben wird',
      'conflict.push': 'Cloud-Spielstand mit dem Spielstand dieses Geräts überschreiben?\n(Ältere Cloud-Versionen bleiben im Gist-Versionsverlauf erhalten.)\n\nAbbrechen: diesmal nicht synchronisieren; der automatische Upload pausiert bis zum nächsten Öffnen der Seite',
      'prompt.token': 'GitHub-Token einfügen (es braucht nur Lese- und Schreibzugriff auf Gists). Leer lassen und OK drücken entfernt das gespeicherte Token.',
      'prompt.device': 'Name für dieses Gerät (wird bei Konflikten angezeigt):',
      'prompt.language': 'Sprache wählen (Nummer eingeben):\n{list}',
      'confirm.pull': 'Lokalen Spielstand durch den Cloud-Spielstand ersetzen? Die Seite wird neu geladen; der aktuelle lokale Spielstand wird vorher gesichert.',
      'confirm.forcePush': 'Cloud-Spielstand mit dem Spielstand dieses Geräts überschreiben? Ältere Cloud-Versionen bleiben im Gist-Versionsverlauf erhalten.',
      'backup.none': 'Noch keine Backups. Das Skript legt nur eines an, wenn der Cloud-Spielstand den lokalen ersetzt.',
      'backup.pick': 'Welches Backup herunterladen? Nummer eingeben:\n{list}',
      'backup.done': 'Heruntergeladen. Öffne im Spiel {path} und wähle diese Datei.',
      'backup.reason.pulled': 'bevor der Cloud-Spielstand ihn ersetzte',
      'status.device': 'Gerät: {v}',
      'status.token': 'Token: {v}',
      'status.gist': 'Gist: {v}',
      'status.local': 'Lokaler Spielstand: {v}',
      'status.localValue': '{size} Zeichen, Hash {hash}',
      'status.base': 'Zuletzt synchronisierte Version: {v}',
      'status.dirty': 'Nicht hochgeladene Änderungen: {v}',
      'status.lastPush': 'Letzter Upload: {v}',
      'status.state': 'Status: {v}',
      'status.language': 'Sprache: {v}',
      'common.set': 'gesetzt',
      'common.unset': 'nicht gesetzt',
      'common.none': 'keine',
      'common.yes': 'ja',
      'common.no': 'nein',
      'common.ok': 'OK',
      'common.notYet': 'in dieser Sitzung noch nicht',
      'common.auto': 'Automatisch (Browsersprache)',
      unknownDevice: 'unbekanntes Gerät',
      unknownTime: 'unbekannte Zeit',
      from: '{device}, {time}',
      gamePath: 'Optionen → Spielstände → Spielstand importieren',
    },
    fr: {
      name: 'Français',
      title: 'Synchro des sauvegardes',
      'menu.token': '⚙️ Définir le jeton GitHub',
      'menu.device': '🏷️ Nommer cet appareil',
      'menu.status': '📊 État de la synchronisation',
      'menu.push': '⬆️ Envoyer la sauvegarde locale maintenant',
      'menu.pull': '⬇️ Remplacer la sauvegarde locale par celle du cloud (recharge la page)',
      'menu.forcePush': '⏫ Écraser la sauvegarde du cloud par la locale',
      'menu.pause': '⏸️ Suspendre / reprendre la synchro auto',
      'menu.backup': '💾 Télécharger une copie de secours du script',
      'menu.language': '🌐 Langue / Language',
      'err.noToken': 'aucun jeton GitHub défini',
      'err.network': 'erreur réseau',
      'err.timeout': 'délai de la requête dépassé',
      'err.badToken': 'le jeton GitHub est invalide ou expiré',
      'err.forbidden': 'GitHub a refusé la requête ({status} : permission manquante ou limite de requêtes)',
      'err.http': 'GitHub a répondu {status}',
      'err.raw': 'impossible de télécharger la sauvegarde du cloud ({status})',
      'toast.needToken': 'Aucun jeton GitHub pour l’instant. Ouvrez le menu du userscript et choisissez « {menu} ».',
      'toast.slow': 'Le réseau était trop lent : le jeu a démarré avec la sauvegarde locale. Rechargez la page pour resynchroniser.',
      'toast.pulled': 'Sauvegarde du cloud chargée ({from}).',
      'toast.skipped': 'Pas de synchronisation cette fois. L’envoi automatique est suspendu jusqu’à la prochaine ouverture de la page.',
      'toast.failed': 'Échec de la synchronisation : {error}. Le jeu utilise la sauvegarde locale comme d’habitude.',
      'toast.remoteChanged': 'Un autre appareil a mis à jour la sauvegarde du cloud ({from}). L’envoi automatique est suspendu ; rechargez la page pour régler cela.',
      'toast.uploaded': 'Envoyée dans le cloud.',
      'toast.uploadFailed': 'Échec de l’envoi, nouvel essai plus tard ({error}).',
      'toast.tokenCleared': 'Jeton GitHub supprimé.',
      'toast.tokenOk': 'Le jeton fonctionne. Rechargez la page pour lancer la synchronisation.',
      'toast.tokenBad': 'Échec de la vérification du jeton : {error}',
      'toast.deviceSet': 'Nom de l’appareil : {name}.',
      'toast.paused': 'Synchronisation automatique suspendue.',
      'toast.resumed': 'Synchronisation automatique reprise. Recharger la page lance d’abord une synchronisation complète.',
      'toast.languageSet': 'Langue : {name}. Rechargez la page pour mettre à jour le menu.',
      'halt.paused': 'suspendue par vous',
      'halt.noToken': 'aucun jeton GitHub',
      'halt.slow': 'synchro trop lente ; le jeu a démarré avec la sauvegarde locale',
      'halt.skipped': 'ignorée cette fois',
      'halt.remote': 'un autre appareil a envoyé une sauvegarde plus récente',
      'conflict.ask': 'Cet appareil et le cloud ont tous deux des modifications : le script ne peut pas savoir laquelle garder.\n\nSauvegarde du cloud : {from}\n\nOK : remplacer la sauvegarde locale par celle du cloud (la locale est copiée avant)\nAnnuler : choisir ensuite d’écraser ou non le cloud avec la sauvegarde locale',
      'conflict.push': 'Écraser la sauvegarde du cloud avec celle de cet appareil ?\n(Les anciennes versions restent dans l’historique des révisions du Gist.)\n\nAnnuler : ne pas synchroniser cette fois ; l’envoi automatique est suspendu jusqu’à la prochaine ouverture de la page',
      'prompt.token': 'Collez votre jeton GitHub (seul l’accès en lecture et écriture aux Gists est nécessaire). Laissez vide et validez pour supprimer le jeton enregistré.',
      'prompt.device': 'Nom de cet appareil (affiché en cas de conflit) :',
      'prompt.language': 'Choisissez une langue (entrez le numéro) :\n{list}',
      'confirm.pull': 'Remplacer la sauvegarde locale par celle du cloud ? La page sera rechargée ; la sauvegarde locale actuelle est copiée avant.',
      'confirm.forcePush': 'Écraser la sauvegarde du cloud avec celle de cet appareil ? Les anciennes versions restent dans l’historique des révisions du Gist.',
      'backup.none': 'Aucune copie pour l’instant. Le script n’en garde une que lorsque la sauvegarde du cloud remplace la locale.',
      'backup.pick': 'Quelle copie télécharger ? Entrez son numéro :\n{list}',
      'backup.done': 'Téléchargé. Dans le jeu, ouvrez {path} et choisissez ce fichier.',
      'backup.reason.pulled': 'avant d’être remplacée par la sauvegarde du cloud',
      'status.device': 'Appareil : {v}',
      'status.token': 'Jeton : {v}',
      'status.gist': 'Gist : {v}',
      'status.local': 'Sauvegarde locale : {v}',
      'status.localValue': '{size} caractères, hash {hash}',
      'status.base': 'Dernière version synchronisée : {v}',
      'status.dirty': 'Modifications non envoyées : {v}',
      'status.lastPush': 'Dernier envoi : {v}',
      'status.state': 'État : {v}',
      'status.language': 'Langue : {v}',
      'common.set': 'défini',
      'common.unset': 'non défini',
      'common.none': 'aucune',
      'common.yes': 'oui',
      'common.no': 'non',
      'common.ok': 'OK',
      'common.notYet': 'pas encore pendant cette session',
      'common.auto': 'Automatique (langue du navigateur)',
      unknownDevice: 'appareil inconnu',
      unknownTime: 'heure inconnue',
      from: '{device}, {time}',
      gamePath: 'Options → Sauvegardes → Importer une sauvegarde',
    },
    es: {
      name: 'Español',
      title: 'Sincronización de partidas',
      'menu.token': '⚙️ Configurar token de GitHub',
      'menu.device': '🏷️ Nombrar este dispositivo',
      'menu.status': '📊 Estado de la sincronización',
      'menu.push': '⬆️ Subir la partida local ahora',
      'menu.pull': '⬇️ Reemplazar la partida local por la de la nube (recarga)',
      'menu.forcePush': '⏫ Sobrescribir la nube con la partida local',
      'menu.pause': '⏸️ Pausar / reanudar la sincronización automática',
      'menu.backup': '💾 Descargar una copia de seguridad del script',
      'menu.language': '🌐 Idioma / Language',
      'err.noToken': 'no hay token de GitHub',
      'err.network': 'error de red',
      'err.timeout': 'la solicitud tardó demasiado',
      'err.badToken': 'el token de GitHub no es válido o ha caducado',
      'err.forbidden': 'GitHub rechazó la solicitud ({status}: falta permiso o se alcanzó el límite)',
      'err.http': 'GitHub respondió {status}',
      'err.raw': 'no se pudo descargar la partida de la nube ({status})',
      'toast.needToken': 'Aún no hay token de GitHub. Abre el menú del userscript y elige «{menu}».',
      'toast.slow': 'La red fue demasiado lenta, así que el juego empezó con la partida local. Recarga la página para volver a sincronizar.',
      'toast.pulled': 'Partida de la nube cargada ({from}).',
      'toast.skipped': 'Esta vez no se sincronizó. La subida automática queda en pausa hasta que vuelvas a abrir la página.',
      'toast.failed': 'Error de sincronización: {error}. El juego usa la partida local como siempre.',
      'toast.remoteChanged': 'Otro dispositivo actualizó la partida de la nube ({from}). La subida automática está en pausa; recarga la página para resolverlo.',
      'toast.uploaded': 'Subida a la nube.',
      'toast.uploadFailed': 'Falló la subida; se reintentará ({error}).',
      'toast.tokenCleared': 'Token de GitHub eliminado.',
      'toast.tokenOk': 'El token funciona. Recarga la página para empezar a sincronizar.',
      'toast.tokenBad': 'Falló la comprobación del token: {error}',
      'toast.deviceSet': 'Nombre del dispositivo: {name}.',
      'toast.paused': 'Sincronización automática en pausa.',
      'toast.resumed': 'Sincronización automática reanudada. Al recargar la página se hará primero una sincronización completa.',
      'toast.languageSet': 'Idioma: {name}. Recarga la página para actualizar el menú.',
      'halt.paused': 'pausada por ti',
      'halt.noToken': 'sin token de GitHub',
      'halt.slow': 'la sincronización fue lenta; el juego empezó con la partida local',
      'halt.skipped': 'omitida esta vez',
      'halt.remote': 'otro dispositivo subió una partida más reciente',
      'conflict.ask': 'Tanto este dispositivo como la nube tienen cambios, así que el script no puede saber cuál conservar.\n\nPartida de la nube: {from}\n\nAceptar: reemplazar la partida local por la de la nube (antes se hace una copia de la local)\nCancelar: elegir después si sobrescribir la nube con la partida local',
      'conflict.push': '¿Sobrescribir la partida de la nube con la de este dispositivo?\n(Las versiones anteriores quedan en el historial de revisiones del Gist.)\n\nCancelar: no sincronizar esta vez; la subida automática queda en pausa hasta que vuelvas a abrir la página',
      'prompt.token': 'Pega tu token de GitHub (solo necesita lectura y escritura de Gists). Déjalo vacío y pulsa Aceptar para borrar el token guardado.',
      'prompt.device': 'Nombre de este dispositivo (se muestra si hay conflicto):',
      'prompt.language': 'Elige un idioma (escribe el número):\n{list}',
      'confirm.pull': '¿Reemplazar la partida local por la de la nube? La página se recargará; antes se hace una copia de la partida local actual.',
      'confirm.forcePush': '¿Sobrescribir la partida de la nube con la de este dispositivo? Las versiones anteriores quedan en el historial de revisiones del Gist.',
      'backup.none': 'Todavía no hay copias. El script solo guarda una cuando la partida de la nube reemplaza a la local.',
      'backup.pick': '¿Qué copia quieres descargar? Escribe su número:\n{list}',
      'backup.done': 'Descargada. En el juego, abre {path} y elige este archivo.',
      'backup.reason.pulled': 'antes de que la reemplazara la partida de la nube',
      'status.device': 'Dispositivo: {v}',
      'status.token': 'Token: {v}',
      'status.gist': 'Gist: {v}',
      'status.local': 'Partida local: {v}',
      'status.localValue': '{size} caracteres, hash {hash}',
      'status.base': 'Última versión sincronizada: {v}',
      'status.dirty': 'Cambios sin subir: {v}',
      'status.lastPush': 'Última subida: {v}',
      'status.state': 'Estado: {v}',
      'status.language': 'Idioma: {v}',
      'common.set': 'configurado',
      'common.unset': 'sin configurar',
      'common.none': 'ninguna',
      'common.yes': 'sí',
      'common.no': 'no',
      'common.ok': 'OK',
      'common.notYet': 'aún no en esta sesión',
      'common.auto': 'Automático (idioma del navegador)',
      unknownDevice: 'dispositivo desconocido',
      unknownTime: 'hora desconocida',
      from: '{device}, {time}',
      gamePath: 'Opciones → Partidas guardadas → Importar partida',
    },
    'pt-BR': {
      name: 'Português (Brasil)',
      title: 'Sincronização de saves',
      'menu.token': '⚙️ Definir token do GitHub',
      'menu.device': '🏷️ Nomear este dispositivo',
      'menu.status': '📊 Status da sincronização',
      'menu.push': '⬆️ Enviar o save local agora',
      'menu.pull': '⬇️ Substituir o save local pelo da nuvem (recarrega)',
      'menu.forcePush': '⏫ Sobrescrever a nuvem com o save local',
      'menu.pause': '⏸️ Pausar / retomar a sincronização automática',
      'menu.backup': '💾 Baixar um backup do script',
      'menu.language': '🌐 Idioma / Language',
      'err.noToken': 'nenhum token do GitHub definido',
      'err.network': 'erro de rede',
      'err.timeout': 'a solicitação expirou',
      'err.badToken': 'o token do GitHub é inválido ou expirou',
      'err.forbidden': 'o GitHub recusou a solicitação ({status}: falta de permissão ou limite de requisições)',
      'err.http': 'o GitHub respondeu {status}',
      'err.raw': 'não foi possível baixar o save da nuvem ({status})',
      'toast.needToken': 'Ainda não há token do GitHub. Abra o menu do userscript e escolha "{menu}".',
      'toast.slow': 'A rede estava lenta demais, então o jogo começou com o save local. Recarregue a página para sincronizar de novo.',
      'toast.pulled': 'Save da nuvem carregado ({from}).',
      'toast.skipped': 'Desta vez não houve sincronização. O envio automático fica pausado até você abrir a página de novo.',
      'toast.failed': 'Falha na sincronização: {error}. O jogo usa o save local normalmente.',
      'toast.remoteChanged': 'Outro dispositivo atualizou o save da nuvem ({from}). O envio automático foi pausado; recarregue a página para resolver.',
      'toast.uploaded': 'Enviado para a nuvem.',
      'toast.uploadFailed': 'Falha no envio; nova tentativa em breve ({error}).',
      'toast.tokenCleared': 'Token do GitHub removido.',
      'toast.tokenOk': 'O token funciona. Recarregue a página para começar a sincronizar.',
      'toast.tokenBad': 'Falha ao verificar o token: {error}',
      'toast.deviceSet': 'Nome do dispositivo: {name}.',
      'toast.paused': 'Sincronização automática pausada.',
      'toast.resumed': 'Sincronização automática retomada. Recarregar a página faz primeiro uma sincronização completa.',
      'toast.languageSet': 'Idioma: {name}. Recarregue a página para atualizar o menu.',
      'halt.paused': 'pausada por você',
      'halt.noToken': 'sem token do GitHub',
      'halt.slow': 'a sincronização demorou; o jogo começou com o save local',
      'halt.skipped': 'ignorada desta vez',
      'halt.remote': 'outro dispositivo enviou um save mais recente',
      'conflict.ask': 'Este dispositivo e a nuvem têm alterações, então o script não sabe qual manter.\n\nSave da nuvem: {from}\n\nOK: substituir o save local pelo da nuvem (o local é copiado antes)\nCancelar: escolher em seguida se quer sobrescrever a nuvem com o save local',
      'conflict.push': 'Sobrescrever o save da nuvem com o deste dispositivo?\n(As versões antigas ficam no histórico de revisões do Gist.)\n\nCancelar: não sincronizar desta vez; o envio automático fica pausado até você abrir a página de novo',
      'prompt.token': 'Cole seu token do GitHub (ele só precisa de leitura e escrita em Gists). Deixe vazio e clique em OK para apagar o token salvo.',
      'prompt.device': 'Nome deste dispositivo (aparece em conflitos):',
      'prompt.language': 'Escolha um idioma (digite o número):\n{list}',
      'confirm.pull': 'Substituir o save local pelo da nuvem? A página será recarregada; o save local atual é copiado antes.',
      'confirm.forcePush': 'Sobrescrever o save da nuvem com o deste dispositivo? As versões antigas ficam no histórico de revisões do Gist.',
      'backup.none': 'Ainda não há backups. O script só guarda um quando o save da nuvem substitui o local.',
      'backup.pick': 'Qual backup baixar? Digite o número:\n{list}',
      'backup.done': 'Baixado. No jogo, abra {path} e escolha este arquivo.',
      'backup.reason.pulled': 'antes de ser substituído pelo save da nuvem',
      'status.device': 'Dispositivo: {v}',
      'status.token': 'Token: {v}',
      'status.gist': 'Gist: {v}',
      'status.local': 'Save local: {v}',
      'status.localValue': '{size} caracteres, hash {hash}',
      'status.base': 'Última versão sincronizada: {v}',
      'status.dirty': 'Alterações não enviadas: {v}',
      'status.lastPush': 'Último envio: {v}',
      'status.state': 'Status: {v}',
      'status.language': 'Idioma: {v}',
      'common.set': 'definido',
      'common.unset': 'não definido',
      'common.none': 'nenhum',
      'common.yes': 'sim',
      'common.no': 'não',
      'common.ok': 'OK',
      'common.notYet': 'ainda não nesta sessão',
      'common.auto': 'Automático (idioma do navegador)',
      unknownDevice: 'dispositivo desconhecido',
      unknownTime: 'horário desconhecido',
      from: '{device}, {time}',
      gamePath: 'Opções → Saves → Importar save',
    },
    pl: {
      name: 'Polski',
      title: 'Synchronizacja zapisów',
      'menu.token': '⚙️ Ustaw token GitHub',
      'menu.device': '🏷️ Nazwij to urządzenie',
      'menu.status': '📊 Stan synchronizacji',
      'menu.push': '⬆️ Wyślij lokalny zapis teraz',
      'menu.pull': '⬇️ Zastąp lokalny zapis zapisem z chmury (przeładuje stronę)',
      'menu.forcePush': '⏫ Nadpisz chmurę lokalnym zapisem',
      'menu.pause': '⏸️ Wstrzymaj / wznów automatyczną synchronizację',
      'menu.backup': '💾 Pobierz kopię zapasową skryptu',
      'menu.language': '🌐 Język / Language',
      'err.noToken': 'nie ustawiono tokenu GitHub',
      'err.network': 'błąd sieci',
      'err.timeout': 'przekroczono czas żądania',
      'err.badToken': 'token GitHub jest nieprawidłowy lub wygasł',
      'err.forbidden': 'GitHub odrzucił żądanie ({status}: brak uprawnień lub limit zapytań)',
      'err.http': 'GitHub zwrócił {status}',
      'err.raw': 'nie udało się pobrać zapisu z chmury ({status})',
      'toast.needToken': 'Brak tokenu GitHub. Otwórz menu userscriptu i wybierz „{menu}”.',
      'toast.slow': 'Sieć była zbyt wolna, więc gra uruchomiła się z lokalnym zapisem. Przeładuj stronę, aby zsynchronizować ponownie.',
      'toast.pulled': 'Wczytano zapis z chmury ({from}).',
      'toast.skipped': 'Tym razem bez synchronizacji. Automatyczne wysyłanie wstrzymane do następnego otwarcia strony.',
      'toast.failed': 'Synchronizacja nie powiodła się: {error}. Gra używa lokalnego zapisu jak zwykle.',
      'toast.remoteChanged': 'Inne urządzenie zaktualizowało zapis w chmurze ({from}). Automatyczne wysyłanie wstrzymane; przeładuj stronę, aby to rozwiązać.',
      'toast.uploaded': 'Wysłano do chmury.',
      'toast.uploadFailed': 'Wysyłanie nie powiodło się, ponowię próbę ({error}).',
      'toast.tokenCleared': 'Usunięto token GitHub.',
      'toast.tokenOk': 'Token działa. Przeładuj stronę, aby rozpocząć synchronizację.',
      'toast.tokenBad': 'Sprawdzenie tokenu nie powiodło się: {error}',
      'toast.deviceSet': 'Nazwa urządzenia: {name}.',
      'toast.paused': 'Automatyczna synchronizacja wstrzymana.',
      'toast.resumed': 'Automatyczna synchronizacja wznowiona. Przeładowanie strony najpierw wykona pełną synchronizację.',
      'toast.languageSet': 'Język: {name}. Przeładuj stronę, aby zaktualizować menu.',
      'halt.paused': 'wstrzymane przez ciebie',
      'halt.noToken': 'brak tokenu GitHub',
      'halt.slow': 'synchronizacja była zbyt wolna; gra uruchomiła się z lokalnym zapisem',
      'halt.skipped': 'pominięto tym razem',
      'halt.remote': 'inne urządzenie wysłało nowszy zapis',
      'conflict.ask': 'Zarówno to urządzenie, jak i chmura mają nowe zmiany, więc skrypt nie wie, który zapis zachować.\n\nZapis w chmurze: {from}\n\nOK: zastąp lokalny zapis zapisem z chmury (lokalny zostanie najpierw skopiowany)\nAnuluj: wybierz potem, czy nadpisać chmurę lokalnym zapisem',
      'conflict.push': 'Nadpisać zapis w chmurze zapisem z tego urządzenia?\n(Starsze wersje zostają w historii zmian Gista.)\n\nAnuluj: tym razem bez synchronizacji; automatyczne wysyłanie wstrzymane do następnego otwarcia strony',
      'prompt.token': 'Wklej token GitHub (wystarczy uprawnienie do odczytu i zapisu Gistów). Zostaw puste i naciśnij OK, aby usunąć zapisany token.',
      'prompt.device': 'Nazwa tego urządzenia (widoczna przy konfliktach):',
      'prompt.language': 'Wybierz język (wpisz numer):\n{list}',
      'confirm.pull': 'Zastąpić lokalny zapis zapisem z chmury? Strona zostanie przeładowana; obecny lokalny zapis zostanie najpierw skopiowany.',
      'confirm.forcePush': 'Nadpisać zapis w chmurze zapisem z tego urządzenia? Starsze wersje zostają w historii zmian Gista.',
      'backup.none': 'Brak kopii zapasowych. Skrypt tworzy kopię tylko wtedy, gdy zapis z chmury zastępuje lokalny.',
      'backup.pick': 'Którą kopię pobrać? Wpisz numer:\n{list}',
      'backup.done': 'Pobrano. W grze otwórz {path} i wybierz ten plik.',
      'backup.reason.pulled': 'przed zastąpieniem zapisem z chmury',
      'status.device': 'Urządzenie: {v}',
      'status.token': 'Token: {v}',
      'status.gist': 'Gist: {v}',
      'status.local': 'Lokalny zapis: {v}',
      'status.localValue': '{size} znaków, hash {hash}',
      'status.base': 'Ostatnio zsynchronizowana wersja: {v}',
      'status.dirty': 'Niewysłane zmiany: {v}',
      'status.lastPush': 'Ostatnie wysłanie: {v}',
      'status.state': 'Stan: {v}',
      'status.language': 'Język: {v}',
      'common.set': 'ustawiony',
      'common.unset': 'nieustawiony',
      'common.none': 'brak',
      'common.yes': 'tak',
      'common.no': 'nie',
      'common.ok': 'OK',
      'common.notYet': 'jeszcze nie w tej sesji',
      'common.auto': 'Automatycznie (język przeglądarki)',
      unknownDevice: 'nieznane urządzenie',
      unknownTime: 'nieznany czas',
      from: '{device}, {time}',
      gamePath: 'Opcje → Zapisy → Importuj zapis',
    },
    ru: {
      name: 'Русский',
      title: 'Синхронизация сохранений',
      'menu.token': '⚙️ Указать токен GitHub',
      'menu.device': '🏷️ Назвать это устройство',
      'menu.status': '📊 Состояние синхронизации',
      'menu.push': '⬆️ Загрузить локальное сохранение сейчас',
      'menu.pull': '⬇️ Заменить локальное сохранение облачным (перезагрузит страницу)',
      'menu.forcePush': '⏫ Перезаписать облако локальным сохранением',
      'menu.pause': '⏸️ Приостановить / возобновить автосинхронизацию',
      'menu.backup': '💾 Скачать резервную копию скрипта',
      'menu.language': '🌐 Язык / Language',
      'err.noToken': 'токен GitHub не указан',
      'err.network': 'ошибка сети',
      'err.timeout': 'превышено время ожидания запроса',
      'err.badToken': 'токен GitHub недействителен или истёк',
      'err.forbidden': 'GitHub отклонил запрос ({status}: нет прав или превышен лимит запросов)',
      'err.http': 'GitHub вернул {status}',
      'err.raw': 'не удалось скачать облачное сохранение ({status})',
      'toast.needToken': 'Токен GitHub ещё не указан. Откройте меню юзерскрипта и выберите «{menu}».',
      'toast.slow': 'Сеть была слишком медленной, поэтому игра запустилась с локальным сохранением. Перезагрузите страницу, чтобы синхронизировать снова.',
      'toast.pulled': 'Облачное сохранение загружено ({from}).',
      'toast.skipped': 'В этот раз синхронизации не было. Автозагрузка приостановлена до следующего открытия страницы.',
      'toast.failed': 'Ошибка синхронизации: {error}. Игра, как обычно, использует локальное сохранение.',
      'toast.remoteChanged': 'Другое устройство обновило облачное сохранение ({from}). Автозагрузка приостановлена; перезагрузите страницу, чтобы разобраться.',
      'toast.uploaded': 'Загружено в облако.',
      'toast.uploadFailed': 'Не удалось загрузить, повторю позже ({error}).',
      'toast.tokenCleared': 'Токен GitHub удалён.',
      'toast.tokenOk': 'Токен работает. Перезагрузите страницу, чтобы начать синхронизацию.',
      'toast.tokenBad': 'Проверка токена не удалась: {error}',
      'toast.deviceSet': 'Имя устройства: {name}.',
      'toast.paused': 'Автосинхронизация приостановлена.',
      'toast.resumed': 'Автосинхронизация возобновлена. При перезагрузке страницы сначала выполнится полная синхронизация.',
      'toast.languageSet': 'Язык: {name}. Перезагрузите страницу, чтобы обновить меню.',
      'halt.paused': 'приостановлено вами',
      'halt.noToken': 'нет токена GitHub',
      'halt.slow': 'синхронизация была слишком медленной; игра запустилась с локальным сохранением',
      'halt.skipped': 'пропущено в этот раз',
      'halt.remote': 'другое устройство загрузило более новое сохранение',
      'conflict.ask': 'И на этом устройстве, и в облаке есть новые изменения, поэтому скрипт не может решить, что оставить.\n\nОблачное сохранение: {from}\n\nОК: заменить локальное сохранение облачным (локальное сначала копируется)\nОтмена: затем выбрать, перезаписать ли облако локальным сохранением',
      'conflict.push': 'Перезаписать облачное сохранение сохранением с этого устройства?\n(Старые версии остаются в истории изменений Gist.)\n\nОтмена: не синхронизировать в этот раз; автозагрузка приостановлена до следующего открытия страницы',
      'prompt.token': 'Вставьте токен GitHub (нужен только доступ на чтение и запись Gist). Оставьте пустым и нажмите ОК, чтобы удалить сохранённый токен.',
      'prompt.device': 'Имя этого устройства (показывается при конфликтах):',
      'prompt.language': 'Выберите язык (введите номер):\n{list}',
      'confirm.pull': 'Заменить локальное сохранение облачным? Страница перезагрузится; текущее локальное сохранение сначала копируется.',
      'confirm.forcePush': 'Перезаписать облачное сохранение сохранением с этого устройства? Старые версии остаются в истории изменений Gist.',
      'backup.none': 'Резервных копий пока нет. Скрипт делает копию, только когда облачное сохранение заменяет локальное.',
      'backup.pick': 'Какую копию скачать? Введите номер:\n{list}',
      'backup.done': 'Скачано. В игре откройте {path} и выберите этот файл.',
      'backup.reason.pulled': 'до замены облачным сохранением',
      'status.device': 'Устройство: {v}',
      'status.token': 'Токен: {v}',
      'status.gist': 'Gist: {v}',
      'status.local': 'Локальное сохранение: {v}',
      'status.localValue': '{size} символов, hash {hash}',
      'status.base': 'Последняя синхронизированная версия: {v}',
      'status.dirty': 'Незагруженные изменения: {v}',
      'status.lastPush': 'Последняя загрузка: {v}',
      'status.state': 'Состояние: {v}',
      'status.language': 'Язык: {v}',
      'common.set': 'указан',
      'common.unset': 'не указан',
      'common.none': 'нет',
      'common.yes': 'есть',
      'common.no': 'нет',
      'common.ok': 'OK',
      'common.notYet': 'в этом сеансе ещё не было',
      'common.auto': 'Автоматически (язык браузера)',
      unknownDevice: 'неизвестное устройство',
      unknownTime: 'неизвестное время',
      from: '{device}, {time}',
      gamePath: 'Настройки → Сохранения → Импорт сохранения',
    },
    uk: {
      name: 'Українська',
      title: 'Синхронізація збережень',
      'menu.token': '⚙️ Вказати токен GitHub',
      'menu.device': '🏷️ Назвати цей пристрій',
      'menu.status': '📊 Стан синхронізації',
      'menu.push': '⬆️ Вивантажити локальне збереження зараз',
      'menu.pull': '⬇️ Замінити локальне збереження хмарним (перезавантажить сторінку)',
      'menu.forcePush': '⏫ Перезаписати хмару локальним збереженням',
      'menu.pause': '⏸️ Призупинити / відновити автосинхронізацію',
      'menu.backup': '💾 Завантажити резервну копію скрипта',
      'menu.language': '🌐 Мова / Language',
      'err.noToken': 'токен GitHub не вказано',
      'err.network': 'помилка мережі',
      'err.timeout': 'час очікування запиту вичерпано',
      'err.badToken': 'токен GitHub недійсний або прострочений',
      'err.forbidden': 'GitHub відхилив запит ({status}: бракує дозволу або перевищено ліміт запитів)',
      'err.http': 'GitHub повернув {status}',
      'err.raw': 'не вдалося завантажити хмарне збереження ({status})',
      'toast.needToken': 'Токен GitHub ще не вказано. Відкрийте меню юзерскрипта й виберіть «{menu}».',
      'toast.slow': 'Мережа була надто повільною, тож гра запустилася з локальним збереженням. Перезавантажте сторінку, щоб синхронізувати знову.',
      'toast.pulled': 'Хмарне збереження завантажено ({from}).',
      'toast.skipped': 'Цього разу без синхронізації. Автовивантаження призупинено до наступного відкриття сторінки.',
      'toast.failed': 'Помилка синхронізації: {error}. Гра, як завжди, використовує локальне збереження.',
      'toast.remoteChanged': 'Інший пристрій оновив хмарне збереження ({from}). Автовивантаження призупинено; перезавантажте сторінку, щоб розібратися.',
      'toast.uploaded': 'Вивантажено в хмару.',
      'toast.uploadFailed': 'Не вдалося вивантажити, повторю пізніше ({error}).',
      'toast.tokenCleared': 'Токен GitHub видалено.',
      'toast.tokenOk': 'Токен працює. Перезавантажте сторінку, щоб почати синхронізацію.',
      'toast.tokenBad': 'Перевірка токена не вдалася: {error}',
      'toast.deviceSet': 'Назва пристрою: {name}.',
      'toast.paused': 'Автосинхронізацію призупинено.',
      'toast.resumed': 'Автосинхронізацію відновлено. Після перезавантаження сторінки спершу буде повна синхронізація.',
      'toast.languageSet': 'Мова: {name}. Перезавантажте сторінку, щоб оновити меню.',
      'halt.paused': 'призупинено вами',
      'halt.noToken': 'немає токена GitHub',
      'halt.slow': 'синхронізація була надто повільною; гра запустилася з локальним збереженням',
      'halt.skipped': 'пропущено цього разу',
      'halt.remote': 'інший пристрій вивантажив новіше збереження',
      'conflict.ask': 'І на цьому пристрої, і в хмарі є нові зміни, тому скрипт не може вирішити, що залишити.\n\nХмарне збереження: {from}\n\nOK: замінити локальне збереження хмарним (локальне спершу копіюється)\nСкасувати: далі вибрати, чи перезаписати хмару локальним збереженням',
      'conflict.push': 'Перезаписати хмарне збереження збереженням із цього пристрою?\n(Старі версії лишаються в історії змін Gist.)\n\nСкасувати: цього разу не синхронізувати; автовивантаження призупинено до наступного відкриття сторінки',
      'prompt.token': 'Вставте токен GitHub (потрібен лише доступ на читання й запис Gist). Залиште порожнім і натисніть OK, щоб видалити збережений токен.',
      'prompt.device': 'Назва цього пристрою (показується під час конфліктів):',
      'prompt.language': 'Виберіть мову (введіть номер):\n{list}',
      'confirm.pull': 'Замінити локальне збереження хмарним? Сторінку буде перезавантажено; поточне локальне збереження спершу копіюється.',
      'confirm.forcePush': 'Перезаписати хмарне збереження збереженням із цього пристрою? Старі версії лишаються в історії змін Gist.',
      'backup.none': 'Резервних копій ще немає. Скрипт робить копію лише тоді, коли хмарне збереження замінює локальне.',
      'backup.pick': 'Яку копію завантажити? Введіть номер:\n{list}',
      'backup.done': 'Завантажено. У грі відкрийте {path} і виберіть цей файл.',
      'backup.reason.pulled': 'до заміни хмарним збереженням',
      'status.device': 'Пристрій: {v}',
      'status.token': 'Токен: {v}',
      'status.gist': 'Gist: {v}',
      'status.local': 'Локальне збереження: {v}',
      'status.localValue': '{size} символів, hash {hash}',
      'status.base': 'Остання синхронізована версія: {v}',
      'status.dirty': 'Невивантажені зміни: {v}',
      'status.lastPush': 'Останнє вивантаження: {v}',
      'status.state': 'Стан: {v}',
      'status.language': 'Мова: {v}',
      'common.set': 'вказано',
      'common.unset': 'не вказано',
      'common.none': 'немає',
      'common.yes': 'є',
      'common.no': 'немає',
      'common.ok': 'OK',
      'common.notYet': 'у цьому сеансі ще не було',
      'common.auto': 'Автоматично (мова браузера)',
      unknownDevice: 'невідомий пристрій',
      unknownTime: 'невідомий час',
      from: '{device}, {time}',
      gamePath: 'Налаштування → Збереження → Імпортувати збереження',
    },
    cs: {
      name: 'Čeština',
      title: 'Synchronizace uložených her',
      'menu.token': '⚙️ Nastavit token GitHubu',
      'menu.device': '🏷️ Pojmenovat toto zařízení',
      'menu.status': '📊 Stav synchronizace',
      'menu.push': '⬆️ Nahrát místní uloženou hru teď',
      'menu.pull': '⬇️ Nahradit místní uloženou hru tou z cloudu (znovu načte stránku)',
      'menu.forcePush': '⏫ Přepsat cloud místní uloženou hrou',
      'menu.pause': '⏸️ Pozastavit / obnovit automatickou synchronizaci',
      'menu.backup': '💾 Stáhnout zálohu skriptu',
      'menu.language': '🌐 Jazyk / Language',
      'err.noToken': 'token GitHubu není nastaven',
      'err.network': 'chyba sítě',
      'err.timeout': 'vypršel časový limit požadavku',
      'err.badToken': 'token GitHubu je neplatný nebo vypršel',
      'err.forbidden': 'GitHub požadavek odmítl ({status}: chybí oprávnění nebo byl překročen limit)',
      'err.http': 'GitHub vrátil {status}',
      'err.raw': 'uloženou hru z cloudu se nepodařilo stáhnout ({status})',
      'toast.needToken': 'Token GitHubu zatím chybí. Otevřete nabídku userscriptu a zvolte „{menu}“.',
      'toast.slow': 'Síť byla příliš pomalá, takže hra začala s místní uloženou hrou. Znovu načtěte stránku a synchronizujte znovu.',
      'toast.pulled': 'Načtena uložená hra z cloudu ({from}).',
      'toast.skipped': 'Tentokrát bez synchronizace. Automatické nahrávání je pozastaveno do příštího otevření stránky.',
      'toast.failed': 'Synchronizace selhala: {error}. Hra používá místní uloženou hru jako obvykle.',
      'toast.remoteChanged': 'Jiné zařízení aktualizovalo uloženou hru v cloudu ({from}). Automatické nahrávání je pozastaveno; znovu načtěte stránku a vyřešte to.',
      'toast.uploaded': 'Nahráno do cloudu.',
      'toast.uploadFailed': 'Nahrání selhalo, zkusím to znovu ({error}).',
      'toast.tokenCleared': 'Token GitHubu odstraněn.',
      'toast.tokenOk': 'Token funguje. Znovu načtěte stránku a synchronizace začne.',
      'toast.tokenBad': 'Kontrola tokenu selhala: {error}',
      'toast.deviceSet': 'Název zařízení: {name}.',
      'toast.paused': 'Automatická synchronizace pozastavena.',
      'toast.resumed': 'Automatická synchronizace obnovena. Po novém načtení stránky proběhne nejdřív úplná synchronizace.',
      'toast.languageSet': 'Jazyk: {name}. Znovu načtěte stránku, aby se aktualizovala nabídka.',
      'halt.paused': 'pozastaveno vámi',
      'halt.noToken': 'chybí token GitHubu',
      'halt.slow': 'synchronizace byla příliš pomalá; hra začala s místní uloženou hrou',
      'halt.skipped': 'tentokrát přeskočeno',
      'halt.remote': 'jiné zařízení nahrálo novější uloženou hru',
      'conflict.ask': 'Toto zařízení i cloud mají nové změny, takže skript nepozná, kterou verzi ponechat.\n\nUložená hra v cloudu: {from}\n\nOK: nahradit místní uloženou hru tou z cloudu (místní se nejdřív zazálohuje)\nZrušit: potom zvolit, zda přepsat cloud místní uloženou hrou',
      'conflict.push': 'Přepsat uloženou hru v cloudu tou z tohoto zařízení?\n(Starší verze zůstanou v historii revizí Gistu.)\n\nZrušit: tentokrát nesynchronizovat; automatické nahrávání se pozastaví do příštího otevření stránky',
      'prompt.token': 'Vložte token GitHubu (stačí oprávnění ke čtení a zápisu Gistů). Ponechte prázdné a stiskněte OK pro odstranění uloženého tokenu.',
      'prompt.device': 'Název tohoto zařízení (zobrazí se při konfliktu):',
      'prompt.language': 'Vyberte jazyk (zadejte číslo):\n{list}',
      'confirm.pull': 'Nahradit místní uloženou hru tou z cloudu? Stránka se znovu načte; současná místní uložená hra se nejdřív zazálohuje.',
      'confirm.forcePush': 'Přepsat uloženou hru v cloudu tou z tohoto zařízení? Starší verze zůstanou v historii revizí Gistu.',
      'backup.none': 'Zatím žádné zálohy. Skript zálohuje jen tehdy, když uložená hra z cloudu nahradí místní.',
      'backup.pick': 'Kterou zálohu stáhnout? Zadejte číslo:\n{list}',
      'backup.done': 'Staženo. Ve hře otevřete {path} a vyberte tento soubor.',
      'backup.reason.pulled': 'před nahrazením uloženou hrou z cloudu',
      'status.device': 'Zařízení: {v}',
      'status.token': 'Token: {v}',
      'status.gist': 'Gist: {v}',
      'status.local': 'Místní uložená hra: {v}',
      'status.localValue': '{size} znaků, hash {hash}',
      'status.base': 'Naposledy synchronizovaná verze: {v}',
      'status.dirty': 'Nenahrané změny: {v}',
      'status.lastPush': 'Poslední nahrání: {v}',
      'status.state': 'Stav: {v}',
      'status.language': 'Jazyk: {v}',
      'common.set': 'nastaven',
      'common.unset': 'nenastaven',
      'common.none': 'žádná',
      'common.yes': 'ano',
      'common.no': 'ne',
      'common.ok': 'OK',
      'common.notYet': 'v této relaci zatím ne',
      'common.auto': 'Automaticky (jazyk prohlížeče)',
      unknownDevice: 'neznámé zařízení',
      unknownTime: 'neznámý čas',
      from: '{device}, {time}',
      gamePath: 'Možnosti → Uložené hry → Importovat uloženou hru',
    },
    ro: {
      name: 'Română',
      title: 'Sincronizare salvări',
      'menu.token': '⚙️ Setează tokenul GitHub',
      'menu.device': '🏷️ Denumește acest dispozitiv',
      'menu.status': '📊 Starea sincronizării',
      'menu.push': '⬆️ Încarcă acum salvarea locală',
      'menu.pull': '⬇️ Înlocuiește salvarea locală cu cea din cloud (reîncarcă pagina)',
      'menu.forcePush': '⏫ Suprascrie cloudul cu salvarea locală',
      'menu.pause': '⏸️ Pauză / reluare sincronizare automată',
      'menu.backup': '💾 Descarcă o copie de rezervă a scriptului',
      'menu.language': '🌐 Limbă / Language',
      'err.noToken': 'niciun token GitHub setat',
      'err.network': 'eroare de rețea',
      'err.timeout': 'cererea a expirat',
      'err.badToken': 'tokenul GitHub este invalid sau a expirat',
      'err.forbidden': 'GitHub a refuzat cererea ({status}: lipsește permisiunea sau s-a atins limita)',
      'err.http': 'GitHub a răspuns {status}',
      'err.raw': 'salvarea din cloud nu a putut fi descărcată ({status})',
      'toast.needToken': 'Încă nu există un token GitHub. Deschide meniul userscriptului și alege „{menu}”.',
      'toast.slow': 'Rețeaua a fost prea lentă, așa că jocul a pornit cu salvarea locală. Reîncarcă pagina pentru a sincroniza din nou.',
      'toast.pulled': 'Salvarea din cloud a fost încărcată ({from}).',
      'toast.skipped': 'De data aceasta nu s-a sincronizat. Încărcarea automată e în pauză până la următoarea deschidere a paginii.',
      'toast.failed': 'Sincronizarea a eșuat: {error}. Jocul folosește salvarea locală ca de obicei.',
      'toast.remoteChanged': 'Alt dispozitiv a actualizat salvarea din cloud ({from}). Încărcarea automată e în pauză; reîncarcă pagina pentru a rezolva.',
      'toast.uploaded': 'Încărcată în cloud.',
      'toast.uploadFailed': 'Încărcarea a eșuat, se va reîncerca ({error}).',
      'toast.tokenCleared': 'Tokenul GitHub a fost șters.',
      'toast.tokenOk': 'Tokenul funcționează. Reîncarcă pagina pentru a începe sincronizarea.',
      'toast.tokenBad': 'Verificarea tokenului a eșuat: {error}',
      'toast.deviceSet': 'Numele dispozitivului: {name}.',
      'toast.paused': 'Sincronizarea automată e în pauză.',
      'toast.resumed': 'Sincronizarea automată a fost reluată. La reîncărcarea paginii se face întâi o sincronizare completă.',
      'toast.languageSet': 'Limba: {name}. Reîncarcă pagina pentru a actualiza meniul.',
      'halt.paused': 'pusă pe pauză de tine',
      'halt.noToken': 'lipsește tokenul GitHub',
      'halt.slow': 'sincronizarea a fost prea lentă; jocul a pornit cu salvarea locală',
      'halt.skipped': 'omisă de data aceasta',
      'halt.remote': 'alt dispozitiv a încărcat o salvare mai nouă',
      'conflict.ask': 'Și acest dispozitiv, și cloudul au modificări noi, așa că scriptul nu poate decide pe care s-o păstreze.\n\nSalvarea din cloud: {from}\n\nOK: înlocuiește salvarea locală cu cea din cloud (cea locală e copiată întâi)\nAnulare: alegi apoi dacă suprascrii cloudul cu salvarea locală',
      'conflict.push': 'Suprascrii salvarea din cloud cu cea de pe acest dispozitiv?\n(Versiunile vechi rămân în istoricul de revizii al Gist-ului.)\n\nAnulare: nu sincroniza de data aceasta; încărcarea automată e în pauză până la următoarea deschidere a paginii',
      'prompt.token': 'Lipește tokenul GitHub (are nevoie doar de citire și scriere pentru Gists). Lasă gol și apasă OK pentru a șterge tokenul salvat.',
      'prompt.device': 'Numele acestui dispozitiv (apare la conflicte):',
      'prompt.language': 'Alege o limbă (introdu numărul):\n{list}',
      'confirm.pull': 'Înlocuiești salvarea locală cu cea din cloud? Pagina se va reîncărca; salvarea locală curentă e copiată întâi.',
      'confirm.forcePush': 'Suprascrii salvarea din cloud cu cea de pe acest dispozitiv? Versiunile vechi rămân în istoricul de revizii al Gist-ului.',
      'backup.none': 'Încă nu există copii de rezervă. Scriptul păstrează una doar când salvarea din cloud o înlocuiește pe cea locală.',
      'backup.pick': 'Ce copie descarci? Introdu numărul:\n{list}',
      'backup.done': 'Descărcat. În joc, deschide {path} și alege acest fișier.',
      'backup.reason.pulled': 'înainte de a fi înlocuită cu salvarea din cloud',
      'status.device': 'Dispozitiv: {v}',
      'status.token': 'Token: {v}',
      'status.gist': 'Gist: {v}',
      'status.local': 'Salvare locală: {v}',
      'status.localValue': '{size} caractere, hash {hash}',
      'status.base': 'Ultima versiune sincronizată: {v}',
      'status.dirty': 'Modificări neîncărcate: {v}',
      'status.lastPush': 'Ultima încărcare: {v}',
      'status.state': 'Stare: {v}',
      'status.language': 'Limbă: {v}',
      'common.set': 'setat',
      'common.unset': 'nesetat',
      'common.none': 'niciuna',
      'common.yes': 'da',
      'common.no': 'nu',
      'common.ok': 'OK',
      'common.notYet': 'încă nu în această sesiune',
      'common.auto': 'Automat (limba browserului)',
      unknownDevice: 'dispozitiv necunoscut',
      unknownTime: 'oră necunoscută',
      from: '{device}, {time}',
      gamePath: 'Opțiuni → Salvări → Importă salvarea',
    },
    tr: {
      name: 'Türkçe',
      title: 'Kayıt senkronizasyonu',
      'menu.token': '⚙️ GitHub token’ını ayarla',
      'menu.device': '🏷️ Bu cihaza ad ver',
      'menu.status': '📊 Senkronizasyon durumu',
      'menu.push': '⬆️ Yerel kaydı şimdi yükle',
      'menu.pull': '⬇️ Yerel kaydı buluttakiyle değiştir (sayfayı yeniler)',
      'menu.forcePush': '⏫ Bulutun üzerine yerel kaydı yaz',
      'menu.pause': '⏸️ Otomatik senkronizasyonu duraklat / sürdür',
      'menu.backup': '💾 Betiğin yedeğini indir',
      'menu.language': '🌐 Dil / Language',
      'err.noToken': 'GitHub token’ı ayarlanmadı',
      'err.network': 'ağ hatası',
      'err.timeout': 'istek zaman aşımına uğradı',
      'err.badToken': 'GitHub token’ı geçersiz ya da süresi dolmuş',
      'err.forbidden': 'GitHub isteği reddetti ({status}: izin eksik ya da istek sınırı aşıldı)',
      'err.http': 'GitHub {status} döndürdü',
      'err.raw': 'buluttaki kayıt indirilemedi ({status})',
      'toast.needToken': 'Henüz GitHub token’ı yok. Kullanıcı betiği menüsünü açıp "{menu}" seçeneğini seçin.',
      'toast.slow': 'Ağ çok yavaştı, oyun yerel kayıtla başladı. Yeniden senkronize etmek için sayfayı yenileyin.',
      'toast.pulled': 'Buluttaki kayıt yüklendi ({from}).',
      'toast.skipped': 'Bu sefer senkronize edilmedi. Otomatik yükleme, sayfa yeniden açılana kadar duraklatıldı.',
      'toast.failed': 'Senkronizasyon başarısız: {error}. Oyun her zamanki gibi yerel kaydı kullanıyor.',
      'toast.remoteChanged': 'Başka bir cihaz buluttaki kaydı güncelledi ({from}). Otomatik yükleme duraklatıldı; çözmek için sayfayı yenileyin.',
      'toast.uploaded': 'Buluta yüklendi.',
      'toast.uploadFailed': 'Yükleme başarısız, tekrar denenecek ({error}).',
      'toast.tokenCleared': 'GitHub token’ı silindi.',
      'toast.tokenOk': 'Token çalışıyor. Senkronizasyonu başlatmak için sayfayı yenileyin.',
      'toast.tokenBad': 'Token kontrolü başarısız: {error}',
      'toast.deviceSet': 'Cihaz adı: {name}.',
      'toast.paused': 'Otomatik senkronizasyon duraklatıldı.',
      'toast.resumed': 'Otomatik senkronizasyon sürdürüldü. Sayfa yenilenince önce tam senkronizasyon yapılır.',
      'toast.languageSet': 'Dil: {name}. Menüyü güncellemek için sayfayı yenileyin.',
      'halt.paused': 'sizin tarafınızdan duraklatıldı',
      'halt.noToken': 'GitHub token’ı yok',
      'halt.slow': 'senkronizasyon çok yavaştı; oyun yerel kayıtla başladı',
      'halt.skipped': 'bu sefer atlandı',
      'halt.remote': 'başka bir cihaz daha yeni bir kayıt yükledi',
      'conflict.ask': 'Hem bu cihazda hem bulutta yeni değişiklikler var; betik hangisinin kalacağına karar veremiyor.\n\nBuluttaki kayıt: {from}\n\nTamam: yerel kaydı buluttakiyle değiştir (yerel kayıt önce yedeklenir)\nİptal: ardından bulutun üzerine yerel kaydın yazılıp yazılmayacağını seç',
      'conflict.push': 'Buluttaki kaydın üzerine bu cihazdaki kayıt yazılsın mı?\n(Eski sürümler Gist revizyon geçmişinde kalır.)\n\nİptal: bu sefer senkronize etme; otomatik yükleme sayfa yeniden açılana kadar duraklatılır',
      'prompt.token': 'GitHub token’ınızı yapıştırın (yalnızca Gists okuma ve yazma izni yeterli). Boş bırakıp Tamam’a basarsanız kayıtlı token silinir.',
      'prompt.device': 'Bu cihazın adı (çakışmalarda gösterilir):',
      'prompt.language': 'Bir dil seçin (numarayı girin):\n{list}',
      'confirm.pull': 'Yerel kayıt buluttakiyle değiştirilsin mi? Sayfa yenilenecek; mevcut yerel kayıt önce yedeklenir.',
      'confirm.forcePush': 'Buluttaki kaydın üzerine bu cihazdaki kayıt yazılsın mı? Eski sürümler Gist revizyon geçmişinde kalır.',
      'backup.none': 'Henüz yedek yok. Betik yalnızca buluttaki kayıt yerel kaydın yerini aldığında yedek tutar.',
      'backup.pick': 'Hangi yedek indirilsin? Numarasını girin:\n{list}',
      'backup.done': 'İndirildi. Oyunda {path} yolunu açıp bu dosyayı seçin.',
      'backup.reason.pulled': 'buluttaki kayıt yerini almadan önce',
      'status.device': 'Cihaz: {v}',
      'status.token': 'Token: {v}',
      'status.gist': 'Gist: {v}',
      'status.local': 'Yerel kayıt: {v}',
      'status.localValue': '{size} karakter, hash {hash}',
      'status.base': 'Son senkronize sürüm: {v}',
      'status.dirty': 'Yüklenmemiş değişiklikler: {v}',
      'status.lastPush': 'Son yükleme: {v}',
      'status.state': 'Durum: {v}',
      'status.language': 'Dil: {v}',
      'common.set': 'ayarlı',
      'common.unset': 'ayarlı değil',
      'common.none': 'yok',
      'common.yes': 'var',
      'common.no': 'yok',
      'common.ok': 'Normal',
      'common.notYet': 'bu oturumda henüz yok',
      'common.auto': 'Otomatik (tarayıcı dili)',
      unknownDevice: 'bilinmeyen cihaz',
      unknownTime: 'bilinmeyen zaman',
      from: '{device}, {time}',
      gamePath: 'Seçenekler → Kayıtlar → Kaydı İçe Aktar',
    },
  };

  const LOCALES = Object.keys(STRINGS);
  let LANG = 'en';

  // Pick a supported locale from a list of browser language tags.
  function detectLocale(tags) {
    for (const raw of tags || []) {
      const tag = String(raw || '').toLowerCase();
      if (!tag) continue;
      if (tag.startsWith('zh')) return /hant|-tw|-hk|-mo/.test(tag) ? 'zh-TW' : 'zh-CN';
      const base = tag.split('-')[0];
      if (base === 'pt') return 'pt-BR';
      if (STRINGS[base]) return base;
    }
    return 'en';
  }

  function browserTags() {
    if (navigator.languages && navigator.languages.length) return navigator.languages;
    return navigator.language ? [navigator.language] : [];
  }

  async function resolveLang() {
    const chosen = await gm.get(K.lang, 'auto');
    return chosen && chosen !== 'auto' && STRINGS[chosen] ? chosen : detectLocale(browserTags());
  }

  function t(key, vars) {
    const table = STRINGS[LANG] || STRINGS.en;
    const text = key in table ? table[key] : key in STRINGS.en ? STRINGS.en[key] : key;
    return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
  }

  // ── Userscript API compatibility (GM_* in Tampermonkey / Violentmonkey, GM.* elsewhere) ──

  const gm = {
    async get(key, fallback) {
      if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
      return GM.getValue(key, fallback);
    },
    async set(key, value) {
      if (typeof GM_setValue === 'function') return GM_setValue(key, value);
      return GM.setValue(key, value);
    },
    menu(label, fn) {
      try {
        if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand(label, fn);
        else GM.registerMenuCommand(label, fn);
      } catch (e) {
        console.warn('[azsync] menu registration failed', e);
      }
    },
    xhr(opts) {
      return new Promise((resolve, reject) => {
        const send = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : GM.xmlHttpRequest;
        send({
          timeout: 15000,
          ...opts,
          onload: (r) => resolve(r),
          onerror: () => reject(new Error(t('err.network'))),
          ontimeout: () => reject(new Error(t('err.timeout'))),
        });
      });
    },
  };

  // ── Gate in the page: hold WebAssembly instantiation until the sync is done ──

  const PAGE_GATE = `(() => {
    if (window.__azsyncGate) return;
    const root = document.documentElement;
    let open = false;
    let release;
    const gate = new Promise((r) => { release = r; });
    const finish = (how) => {
      if (open) return;
      open = true;
      root.setAttribute(${JSON.stringify(GATE_ATTR)}, how);
      release();
    };
    window.__azsyncGate = gate;
    document.addEventListener(${JSON.stringify(GATE_EVENT)}, () => finish('released'));
    setTimeout(() => finish('timeout'), ${Number(T.gateTimeoutMs)});
    for (const name of ['instantiate', 'instantiateStreaming']) {
      const orig = WebAssembly[name];
      if (typeof orig !== 'function') continue;
      WebAssembly[name] = function (...args) {
        return gate.then(() => orig.apply(WebAssembly, args));
      };
    }
  })();`;

  function injectGate() {
    const s = document.createElement('script');
    s.textContent = PAGE_GATE;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  }

  function releaseGate() {
    document.dispatchEvent(new CustomEvent(GATE_EVENT));
  }

  function gateTimedOut() {
    return document.documentElement.getAttribute(GATE_ATTR) === 'timeout';
  }

  // ── Helpers ──

  async function sha(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function readLocal() {
    try {
      return localStorage.getItem(SAVE_KEY);
    } catch {
      return null;
    }
  }

  function writeLocal(text) {
    localStorage.setItem(SAVE_KEY, text);
  }

  function fmtTime(iso) {
    if (!iso) return t('unknownTime');
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    try {
      return d.toLocaleString(LANG);
    } catch {
      return d.toLocaleString();
    }
  }

  function describe(remote) {
    const m = remote && remote.meta;
    if (!m) return t('unknownDevice');
    return t('from', { device: m.device || t('unknownDevice'), time: fmtTime(m.updatedAt) });
  }

  async function deviceName() {
    let name = await gm.get(K.device, '');
    if (!name) {
      const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || 'Browser';
      name = `${platform}-${Math.random().toString(36).slice(2, 6)}`;
      await gm.set(K.device, name);
    }
    return name;
  }

  let toastBox = null;
  function toast(msg, quiet = false) {
    const text = `${t('title')} · ${msg}`;
    console.info('[azsync]', text);
    const show = () => {
      if (!document.body) return;
      if (!toastBox) {
        toastBox = document.createElement('div');
        toastBox.style.cssText = [
          'position:fixed', 'left:12px', 'bottom:12px', 'z-index:2147483647', 'max-width:420px',
          'padding:8px 12px', 'border-radius:6px', 'background:rgba(0,0,0,.78)', 'color:#fff',
          'font:13px/1.5 system-ui,sans-serif', 'pointer-events:none', 'transition:opacity .3s',
        ].join(';');
        document.body.appendChild(toastBox);
      }
      toastBox.textContent = text;
      toastBox.style.opacity = '1';
      clearTimeout(toastBox._t);
      toastBox._t = setTimeout(() => { toastBox.style.opacity = '0'; }, quiet ? 2500 : 7000);
    };
    if (document.body) show();
    else document.addEventListener('DOMContentLoaded', show, { once: true });
  }

  function ask(key, vars) {
    return confirm(`[${t('title')}] ${t(key, vars)}`);
  }

  // ── GitHub Gist ──

  async function gh(method, path, body) {
    const token = await gm.get(K.token, '');
    if (!token) throw new Error(t('err.noToken'));
    let url = API + path;
    // Skip the browser cache for GETs (GitHub's API sends max-age=60)
    if (method === 'GET') url += (url.includes('?') ? '&' : '?') + '_=' + Date.now();
    const r = await gm.xhr({
      method,
      url,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      data: body === undefined ? undefined : JSON.stringify(body),
      nocache: true,
    });
    if (r.status === 404 && method === 'GET') return null;
    if (r.status === 401) throw new Error(t('err.badToken'));
    if (r.status === 403 || r.status === 429) throw new Error(t('err.forbidden', { status: r.status }));
    if (r.status < 200 || r.status >= 300) throw new Error(t('err.http', { status: r.status }));
    return r.responseText ? JSON.parse(r.responseText) : null;
  }

  // The Gist used for syncing: the remembered id, or else the one among your gists that holds the
  // meta file (so a second device only needs the token).
  async function gistId() {
    const cached = await gm.get(K.gistId, '');
    if (cached) return cached;
    for (let page = 1; page <= 10; page++) {
      const list = await gh('GET', `/gists?per_page=100&page=${page}`);
      if (!list || !list.length) break;
      const hit = list.find((g) => g.files && g.files[FILE_META]);
      if (hit) {
        await gm.set(K.gistId, hit.id);
        return hit.id;
      }
      if (list.length < 100) break;
    }
    return '';
  }

  async function readRemote() {
    const id = await gistId();
    if (!id) return null;
    const g = await gh('GET', `/gists/${id}`);
    if (!g) {
      // The gist was deleted: forget it; the next upload creates a new one
      await gm.set(K.gistId, '');
      return null;
    }
    const f = g.files && g.files[FILE_SAVE];
    if (!f) return null;
    let save = f.content;
    if (f.truncated || typeof save !== 'string') {
      // The API cuts files over 1 MB short; the full text is at raw_url
      const r = await gm.xhr({ method: 'GET', url: f.raw_url, nocache: true });
      if (r.status !== 200) throw new Error(t('err.raw', { status: r.status }));
      save = r.responseText;
    }
    let meta = null;
    try {
      meta = JSON.parse((g.files[FILE_META] && g.files[FILE_META].content) || 'null');
    } catch {
      meta = null;
    }
    return { id, url: g.html_url, save, hash: await sha(save), meta };
  }

  async function writeRemote(text, hash) {
    const meta = {
      v: 1,
      hash,
      size: text.length,
      device: await deviceName(),
      updatedAt: new Date().toISOString(),
    };
    const files = {
      [FILE_SAVE]: { content: text },
      [FILE_META]: { content: JSON.stringify(meta, null, 2) },
    };
    const id = await gistId();
    if (id) {
      await gh('PATCH', `/gists/${id}`, { files });
    } else {
      const g = await gh('POST', '/gists', { description: GIST_DESC, public: false, files });
      await gm.set(K.gistId, g.id);
    }
    await gm.set(K.base, hash);
    return meta;
  }

  async function backup(text, reason) {
    if (!text) return;
    const list = (await gm.get(K.backups, [])) || [];
    list.unshift({ at: new Date().toISOString(), reason, text });
    await gm.set(K.backups, list.slice(0, T.backups));
  }

  // ── Deciding what to do ──

  // L: hash of the local save, R: hash of the cloud save, B: hash last synced (null if none)
  function decide(L, R, B) {
    if (L === R) return L ? 'same' : 'empty';
    if (!R) return 'push';
    if (!L) return 'pull';
    if (L === B) return 'pull';
    if (R === B) return 'push';
    return 'conflict';
  }

  function askConflict(remote) {
    if (ask('conflict.ask', { from: describe(remote) })) return 'pull';
    return ask('conflict.push') ? 'push-force' : 'skip';
  }

  const S = {
    lastSeen: undefined, // the local save as last seen
    dirty: false, // local changes not uploaded yet
    changedAt: 0,
    pushing: false,
    lastPushAt: 0,
    halted: '', // when set, auto upload stops for this session; holds a halt.* key
  };

  // Runs once when the page opens: pull, push or ask, then let the game start.
  async function bootSync() {
    let after = '';
    try {
      if (await gm.get(K.paused, false)) {
        S.halted = 'halt.paused';
        return;
      }
      if (!(await gm.get(K.token, ''))) {
        S.halted = 'halt.noToken';
        toast(t('toast.needToken', { menu: t('menu.token') }));
        return;
      }
      const forcePull = await gm.get(K.forcePull, false);
      if (forcePull) await gm.set(K.forcePull, false);

      const remote = await readRemote();
      const localText = readLocal();
      const L = localText ? await sha(localText) : null;
      const R = remote ? remote.hash : null;
      const B = await gm.get(K.base, null);

      let action = forcePull && R && R !== L ? 'pull' : decide(L, R, B);
      if (action === 'conflict') action = askConflict(remote);

      if (action === 'pull' && gateTimedOut()) {
        // The game already started with the local save; writing now would be overwritten by it
        S.halted = 'halt.slow';
        toast(t('toast.slow'));
        return;
      }

      if (action === 'same') {
        await gm.set(K.base, L);
      } else if (action === 'pull') {
        await backup(localText, 'pulled');
        writeLocal(remote.save);
        await gm.set(K.base, R);
        toast(t('toast.pulled', { from: describe(remote) }));
      } else if (action === 'push') {
        after = 'push';
      } else if (action === 'push-force') {
        after = 'force';
      } else if (action === 'skip') {
        S.halted = 'halt.skipped';
        toast(t('toast.skipped'));
      }
    } catch (e) {
      toast(t('toast.failed', { error: e.message }));
    } finally {
      S.lastSeen = readLocal();
      releaseGate();
    }
    if (after) await pushIfSafe(after === 'force');
  }

  // Upload the local save. Look at the cloud first: if another device changed it (and this is not
  // forced), stop rather than overwrite.
  async function pushIfSafe(force = false) {
    if (S.pushing) return;
    if (S.halted && !force) return;
    const text = readLocal();
    if (!text) return;
    S.pushing = true;
    try {
      const L = await sha(text);
      const B = await gm.get(K.base, null);
      if (L === B && !force) {
        S.dirty = false;
        return;
      }
      const remote = await readRemote();
      const R = remote ? remote.hash : null;
      if (R === L) {
        await gm.set(K.base, L);
        if (readLocal() === text) S.dirty = false;
        return;
      }
      if (!force && R && R !== B) {
        S.halted = 'halt.remote';
        toast(t('toast.remoteChanged', { from: describe(remote) }));
        return;
      }
      await writeRemote(text, L);
      S.lastPushAt = Date.now();
      if (force) S.halted = '';
      if (readLocal() === text) S.dirty = false;
      toast(t('toast.uploaded'), true);
    } catch (e) {
      S.changedAt = Date.now(); // try again a little later
      toast(t('toast.uploadFailed', { error: e.message }));
    } finally {
      S.pushing = false;
    }
  }

  function tick() {
    const text = readLocal();
    if (text !== S.lastSeen) {
      S.lastSeen = text;
      S.dirty = true;
      S.changedAt = Date.now();
    }
    const now = Date.now();
    if (S.dirty && !S.halted && now - S.changedAt >= T.debounceMs && now - S.lastPushAt >= T.minPushGapMs) {
      pushIfSafe();
    }
  }

  function startWatcher() {
    setInterval(tick, T.pollMs);
    // On leaving or closing the page, try to upload pending changes. If it doesn't finish, the next
    // page open sees the newer local save and uploads it.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return;
      tick();
      if (S.dirty && !S.halted) pushIfSafe();
    });
  }

  // ── Userscript menu ──

  async function setToken() {
    const input = prompt(t('prompt.token'), '');
    if (input === null) return;
    const token = input.trim();
    await gm.set(K.token, token);
    if (!token) {
      toast(t('toast.tokenCleared'));
      return;
    }
    try {
      await gh('GET', '/gists?per_page=1');
      toast(t('toast.tokenOk'));
    } catch (e) {
      toast(t('toast.tokenBad', { error: e.message }));
    }
  }

  async function setDevice() {
    const name = prompt(t('prompt.device'), await deviceName());
    if (name === null || !name.trim()) return;
    await gm.set(K.device, name.trim());
    toast(t('toast.deviceSet', { name: name.trim() }));
  }

  async function chooseLanguage() {
    const list = [`0. ${t('common.auto')}`, ...LOCALES.map((code, i) => `${i + 1}. ${STRINGS[code].name}`)].join('\n');
    const pick = prompt(t('prompt.language', { list }), '');
    if (pick === null || pick.trim() === '') return;
    const n = Number(pick.trim());
    if (!Number.isInteger(n) || n < 0 || n > LOCALES.length) return;
    const chosen = n === 0 ? 'auto' : LOCALES[n - 1];
    await gm.set(K.lang, chosen);
    LANG = await resolveLang();
    toast(t('toast.languageSet', { name: chosen === 'auto' ? t('common.auto') : STRINGS[chosen].name }));
  }

  async function forcePullAndReload() {
    if (!ask('confirm.pull')) return;
    await gm.set(K.forcePull, true);
    location.reload();
  }

  async function forcePush() {
    if (!ask('confirm.forcePush')) return;
    await pushIfSafe(true);
  }

  async function togglePause() {
    const paused = !(await gm.get(K.paused, false));
    await gm.set(K.paused, paused);
    if (paused) S.halted = 'halt.paused';
    else if (S.halted === 'halt.paused') S.halted = '';
    toast(t(paused ? 'toast.paused' : 'toast.resumed'));
  }

  async function showStatus() {
    const local = readLocal();
    const id = await gm.get(K.gistId, '');
    const base = await gm.get(K.base, null);
    const chosen = await gm.get(K.lang, 'auto');
    const lines = [
      t('status.device', { v: await deviceName() }),
      t('status.token', { v: t((await gm.get(K.token, '')) ? 'common.set' : 'common.unset') }),
      t('status.gist', { v: id ? `https://gist.github.com/${id}` : t('common.none') }),
      t('status.local', {
        v: local ? t('status.localValue', { size: local.length, hash: (await sha(local)).slice(0, 12) }) : t('common.none'),
      }),
      t('status.base', { v: base ? base.slice(0, 12) : t('common.none') }),
      t('status.dirty', { v: t(S.dirty ? 'common.yes' : 'common.no') }),
      t('status.lastPush', { v: S.lastPushAt ? fmtTime(new Date(S.lastPushAt).toISOString()) : t('common.notYet') }),
      t('status.state', { v: S.halted ? t(S.halted) : t('common.ok') }),
      t('status.language', { v: `${STRINGS[LANG].name}${chosen === 'auto' ? ` (${t('common.auto')})` : ''}` }),
    ];
    alert(`[${t('title')}]\n\n${lines.join('\n')}`);
  }

  async function downloadBackup() {
    const list = (await gm.get(K.backups, [])) || [];
    if (!list.length) {
      alert(`[${t('title')}] ${t('backup.none')}`);
      return;
    }
    const menu = list.map((b, i) => `${i + 1}. ${fmtTime(b.at)} (${t(`backup.reason.${b.reason}`)})`).join('\n');
    const pick = prompt(t('backup.pick', { list: menu }), '1');
    const b = list[Number(pick) - 1];
    if (!b) return;
    const stamp = b.at.replace(/[:T]/g, '-').slice(0, 19);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([b.text], { type: 'application/octet-stream' }));
    a.download = `AzerothSurvivors azsync-backup ${stamp}.sav`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    alert(`[${t('title')}] ${t('backup.done', { path: t('gamePath') })}`);
  }

  function registerMenus() {
    gm.menu(t('menu.token'), setToken);
    gm.menu(t('menu.device'), setDevice);
    gm.menu(t('menu.status'), showStatus);
    gm.menu(t('menu.push'), () => pushIfSafe(false));
    gm.menu(t('menu.pull'), forcePullAndReload);
    gm.menu(t('menu.forcePush'), forcePush);
    gm.menu(t('menu.pause'), togglePause);
    gm.menu(t('menu.backup'), downloadBackup);
    gm.menu(t('menu.language'), chooseLanguage);
  }

  async function main() {
    injectGate();
    try {
      LANG = await resolveLang();
    } catch {
      LANG = 'en';
    }
    registerMenus();
    await bootSync();
    startWatcher();
  }

  if (TEST) {
    TEST.exports = {
      main, decide, bootSync, pushIfSafe, tick, injectGate, startWatcher, detectLocale, resolveLang, t,
      setLang: (code) => { LANG = code; },
      STRINGS, state: S, keys: K, SAVE_KEY,
    };
    if (TEST.noMain) return;
  }
  main();
})();
