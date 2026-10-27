// Runs the userscript in Node with two simulated devices (each with its own localStorage and
// userscript storage) sharing one fake GitHub Gist server.
//
//   node tests/sync.test.mjs [path/to/script.user.js]
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = process.argv[2] || path.join(ROOT, 'azeroth-survivors-cloud-save.user.js');
const src = fs.readFileSync(SCRIPT, 'utf8');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeGist({ truncateAt = Infinity, latency = 20 } = {}) {
  let n = 0;
  const server = {
    gists: new Map(),
    log: [],
    failNext: 0,
    token: 'tok',
    latency,
    handle(o) {
      setTimeout(() => {
        const gists = server.gists;
        if (server.failNext > 0) {
          server.failNext--;
          o.onerror();
          return;
        }
        const u = new URL(o.url);
        server.log.push(`${o.method} ${u.pathname}`);
        const reply = (status, body) => o.onload({ status, responseText: body === undefined ? '' : JSON.stringify(body) });
        if (u.hostname === 'gist.githubusercontent.com') {
          const [, , id, file] = u.pathname.split('/');
          const g = gists.get(id);
          o.onload({ status: g ? 200 : 404, responseText: g ? g.files[file] : '' });
          return;
        }
        if (o.headers?.Authorization !== `Bearer ${server.token}`) return reply(401, { message: 'Bad credentials' });
        const view = (g) => ({
          id: g.id,
          html_url: `https://gist.github.com/${g.id}`,
          description: g.description,
          files: Object.fromEntries(
            Object.entries(g.files).map(([name, content]) => {
              const truncated = content.length > truncateAt;
              return [name, {
                filename: name,
                truncated,
                content: truncated ? content.slice(0, truncateAt) : content,
                raw_url: `https://gist.githubusercontent.com/raw/${g.id}/${name}`,
              }];
            })
          ),
        });
        const m = u.pathname.match(/^\/gists(?:\/([^/]+))?$/);
        if (!m) return reply(404, {});
        const id = m[1];
        const body = o.data ? JSON.parse(o.data) : null;
        if (o.method === 'GET' && !id) return reply(200, [...gists.values()].reverse().map(view));
        if (o.method === 'GET') return gists.has(id) ? reply(200, view(gists.get(id))) : reply(404, {});
        if (o.method === 'POST' && !id) {
          assert.equal(body.public, false, 'the gist must be secret');
          const g = { id: `g${++n}`, description: body.description, files: {}, revisions: 1 };
          for (const [k, v] of Object.entries(body.files)) g.files[k] = v.content;
          gists.set(g.id, g);
          return reply(201, view(g));
        }
        if (o.method === 'PATCH' && id && gists.has(id)) {
          const g = gists.get(id);
          for (const [k, v] of Object.entries(body.files)) g.files[k] = v.content;
          g.revisions++;
          return reply(200, view(g));
        }
        reply(404, {});
      }, server.latency);
    },
  };
  return server;
}

function device(name, server, { confirms = [], timing = {}, languages = ['en-US'] } = {}) {
  const ls = new Map();
  const gmStore = new Map([['token', server.token], ['device', name]]);
  const listeners = {};
  const attrs = {};
  const toasts = [];
  const dialogs = [];
  const menus = [];
  let ctx;
  const el = (tag) => ({ tag, style: {}, textContent: '', remove() {}, click() {} });
  const document = {
    head: null,
    body: { appendChild() {} },
    visibilityState: 'visible',
    documentElement: {
      setAttribute: (k, v) => { attrs[k] = v; },
      getAttribute: (k) => attrs[k] ?? null,
      appendChild: (e) => { if (e.tag === 'script') vm.runInContext(e.textContent, ctx); },
    },
    createElement: el,
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    dispatchEvent: (e) => { (listeners[e.type] || []).forEach((fn) => fn(e)); },
  };
  const test = {
    timing: { pollMs: 30, debounceMs: 60, minPushGapMs: 0, gateTimeoutMs: 3000, ...timing },
    noMain: true,
  };
  ctx = {
    console: { info: (...a) => toasts.push(a.slice(1).join(' ')), warn() {}, log: console.log },
    setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, URL, Blob: class {},
    crypto: webcrypto,
    CustomEvent: class { constructor(type) { this.type = type; } },
    document,
    WebAssembly: { instantiate: async (x) => `instance:${x}` },
    navigator: { platform: 'Test', languages },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)) },
    location: { reload() { ctx.reloaded = true; } },
    confirm: (msg) => {
      dialogs.push(msg);
      if (!confirms.length) throw new Error(`${name}: unexpected confirm dialog`);
      return confirms.shift();
    },
    prompt: () => null,
    alert: (msg) => dialogs.push(msg),
    GM_getValue: (k, d) => (gmStore.has(k) ? structuredClone(gmStore.get(k)) : d),
    GM_setValue: (k, v) => { gmStore.set(k, structuredClone(v)); },
    GM_registerMenuCommand: (label) => menus.push(label),
    GM_xmlhttpRequest: (o) => server.handle(o),
    __AZSYNC_TEST__: test,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const x = test.exports;
  return {
    name, ls, gmStore, toasts, dialogs, menus, ctx, x, attrs, confirms,
    get save() { return ls.get('rogue.characters') ?? null; },
    set save(v) { ls.set('rogue.characters', v); },
  };
}

const remoteSave = (server) => [...server.gists.values()][0]?.files['azeroth-survivors.sav'] ?? null;
const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.stack]);
  }
}

// ── Sync ──

await test('first run: local save, no gist → creates a secret gist and uploads', async () => {
  const s = fakeGist();
  const a = device('A', s);
  a.save = 'RSE1:save-v1';
  await a.x.bootSync();
  assert.equal(remoteSave(s), 'RSE1:save-v1');
  assert.equal(s.gists.size, 1);
});

await test('second device with only the token finds the gist and pulls the save', async () => {
  const s = fakeGist();
  const a = device('A', s);
  a.save = 'S1';
  await a.x.bootSync();
  const b = device('B', s);
  await b.x.bootSync();
  assert.equal(b.save, 'S1');
  assert.equal(b.gmStore.get('gistId'), a.gmStore.get('gistId'));
});

await test('gate: the game waits until the pulled save is written', async () => {
  const s = fakeGist({ latency: 150 });
  const a = device('A', s);
  a.save = 'S1';
  await a.x.bootSync();
  const b = device('B', s);
  b.x.injectGate();
  let seenByGame = 'not-yet';
  const game = b.ctx.WebAssembly.instantiate('mod').then(() => { seenByGame = b.save; });
  await sleep(50);
  assert.equal(seenByGame, 'not-yet', 'must not start before the sync is done');
  await b.x.bootSync();
  await game;
  assert.equal(seenByGame, 'S1', 'the game must read the cloud save');
  assert.equal(b.attrs['data-azsync'], 'released');
});

await test('gate timeout: a slow sync no longer writes the local save', async () => {
  const s = fakeGist();
  const a = device('A', s);
  a.save = 'S1';
  await a.x.bootSync();
  s.latency = 300;
  const b = device('B', s, { timing: { gateTimeoutMs: 100 } });
  b.save = 'local-old';
  b.gmStore.set('baseHash', sha256('local-old'));
  b.x.injectGate();
  const game = b.ctx.WebAssembly.instantiate('mod');
  await b.x.bootSync();
  await game;
  assert.equal(b.attrs['data-azsync'], 'timeout');
  assert.equal(b.save, 'local-old', 'must not touch the local save after the timeout');
  assert.equal(b.x.state.halted, 'halt.slow');
});

await test('progress on B uploads automatically; A pulls it next time and backs up its old save', async () => {
  const s = fakeGist();
  const a = device('A', s);
  a.save = 'S1';
  await a.x.bootSync();
  const b = device('B', s);
  await b.x.bootSync();
  b.x.startWatcher();
  b.save = 'S2';
  await sleep(250);
  assert.equal(remoteSave(s), 'S2', 'uploads once the save stops changing');
  const a2 = device('A', s);
  for (const [k, v] of a.gmStore) a2.gmStore.set(k, v);
  a2.save = a.save;
  await a2.x.bootSync();
  assert.equal(a2.save, 'S2');
  assert.equal(a2.gmStore.get('backups')[0].text, 'S1');
  assert.equal(a2.gmStore.get('backups')[0].reason, 'pulled');
});

await test('both changed, "use cloud" → local replaced and backed up', async () => {
  const s = fakeGist();
  const a = device('A', s, { confirms: [true] });
  a.save = 'S1';
  await a.x.bootSync();
  const b = device('B', s);
  await b.x.bootSync();
  b.save = 'B-new';
  await b.x.pushIfSafe();
  a.save = 'A-offline';
  await a.x.bootSync();
  assert.equal(a.save, 'B-new');
  assert.equal(a.gmStore.get('backups')[0].text, 'A-offline');
  assert.equal(a.confirms.length, 0);
});

await test('both changed, cancel twice → nothing changes and auto upload pauses', async () => {
  const s = fakeGist();
  const a = device('A', s, { confirms: [false, false] });
  a.save = 'S1';
  await a.x.bootSync();
  const b = device('B', s);
  await b.x.bootSync();
  b.save = 'B-new';
  await b.x.pushIfSafe();
  a.save = 'A-offline';
  await a.x.bootSync();
  assert.equal(a.save, 'A-offline');
  assert.equal(remoteSave(s), 'B-new');
  assert.equal(a.x.state.halted, 'halt.skipped');
  await a.x.pushIfSafe();
  assert.equal(remoteSave(s), 'B-new', 'must not upload while paused');
});

await test('both changed, "use local" → local uploaded', async () => {
  const s = fakeGist();
  const a = device('A', s, { confirms: [false, true] });
  a.save = 'S1';
  await a.x.bootSync();
  const b = device('B', s);
  await b.x.bootSync();
  b.save = 'B-new';
  await b.x.pushIfSafe();
  a.save = 'A-offline';
  await a.x.bootSync();
  assert.equal(remoteSave(s), 'A-offline');
});

await test('playing on two devices at once: the later upload stops instead of overwriting', async () => {
  const s = fakeGist();
  const a = device('A', s);
  a.save = 'S1';
  await a.x.bootSync();
  const b = device('B', s);
  await b.x.bootSync();
  b.save = 'B-run';
  await b.x.pushIfSafe();
  a.save = 'A-run';
  await a.x.pushIfSafe();
  assert.equal(remoteSave(s), 'B-run');
  assert.equal(a.x.state.halted, 'halt.remote');
});

await test('network errors: the upload retries and gets through', async () => {
  const s = fakeGist();
  const a = device('A', s);
  a.save = 'S1';
  await a.x.bootSync();
  a.x.startWatcher();
  s.failNext = 2;
  a.save = 'S2';
  await sleep(600);
  assert.equal(remoteSave(s), 'S2');
});

await test('network down at page open: the game starts with the local save', async () => {
  const s = fakeGist();
  const a = device('A', s);
  a.save = 'S1';
  s.failNext = 5;
  a.x.injectGate();
  const game = a.ctx.WebAssembly.instantiate('m');
  await a.x.bootSync();
  await game;
  assert.equal(a.save, 'S1');
  assert.equal(a.attrs['data-azsync'], 'released');
});

await test('save over 1 MB (truncated by the API) → full text from raw_url', async () => {
  const s = fakeGist({ truncateAt: 10 });
  const a = device('A', s);
  a.save = 'X'.repeat(50);
  await a.x.bootSync();
  const b = device('B', s);
  await b.x.bootSync();
  assert.equal(b.save, 'X'.repeat(50));
});

await test('wrong token: shows a message and the game still starts', async () => {
  const s = fakeGist();
  const a = device('A', s);
  a.gmStore.set('token', 'wrong');
  a.save = 'S1';
  a.x.injectGate();
  const game = a.ctx.WebAssembly.instantiate('m');
  await a.x.bootSync();
  await game;
  assert.ok(a.toasts.some((t) => t.includes('invalid or expired')));
});

await test('no token: sends no requests and lets the game start', async () => {
  const s = fakeGist();
  const a = device('A', s);
  a.gmStore.delete('token');
  a.save = 'S1';
  await a.x.bootSync();
  assert.equal(s.log.length, 0);
  assert.equal(a.x.state.halted, 'halt.noToken');
});

await test('decide() three-way cases', async () => {
  const { decide } = device('A', fakeGist()).x;
  assert.equal(decide('a', 'a', null), 'same');
  assert.equal(decide(null, null, null), 'empty');
  assert.equal(decide('a', null, null), 'push');
  assert.equal(decide(null, 'r', 'b'), 'pull');
  assert.equal(decide('b', 'r', 'b'), 'pull');
  assert.equal(decide('l', 'b', 'b'), 'push');
  assert.equal(decide('l', 'r', 'b'), 'conflict');
  assert.equal(decide('l', 'r', null), 'conflict');
});

await test('main(): gate, menus in the browser language, pull, then the game starts', async () => {
  const s = fakeGist({ latency: 80 });
  const a = device('A', s);
  a.save = 'S1';
  await a.x.bootSync();
  const b = device('B', s, { languages: ['ko-KR'] });
  const started = b.x.main();
  let seenByGame = 'not-yet';
  const game = b.ctx.WebAssembly.instantiate('mod').then(() => { seenByGame = b.save; });
  await started;
  await game;
  assert.equal(seenByGame, 'S1');
  assert.equal(b.menus.length, 9);
  assert.equal(b.menus[0], '⚙️ GitHub 토큰 설정');
});

// ── Translations ──

await test('every locale has exactly the English keys', async () => {
  const { STRINGS } = device('A', fakeGist()).x;
  const en = Object.keys(STRINGS.en).sort();
  for (const [code, table] of Object.entries(STRINGS)) {
    assert.deepEqual(Object.keys(table).sort(), en, `${code} keys differ from en`);
    for (const [k, v] of Object.entries(table)) assert.ok(typeof v === 'string' && v.trim(), `${code}.${k} is empty`);
  }
});

await test('every translation keeps the same {placeholders}', async () => {
  const { STRINGS } = device('A', fakeGist()).x;
  const holes = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
  for (const [code, table] of Object.entries(STRINGS)) {
    for (const k of Object.keys(STRINGS.en)) {
      assert.equal(holes(table[k]), holes(STRINGS.en[k]), `${code}.${k} placeholders`);
    }
  }
});

await test('covers the 14 game languages plus Traditional Chinese', async () => {
  const { STRINGS } = device('A', fakeGist()).x;
  assert.deepEqual(
    Object.keys(STRINGS).sort(),
    ['cs', 'de', 'en', 'es', 'fr', 'ja', 'ko', 'pl', 'pt-BR', 'ro', 'ru', 'tr', 'uk', 'zh-CN', 'zh-TW'].sort()
  );
});

await test('detectLocale() maps browser language tags', async () => {
  const { detectLocale } = device('A', fakeGist()).x;
  const cases = [
    [['zh-CN'], 'zh-CN'], [['zh'], 'zh-CN'], [['zh-SG'], 'zh-CN'], [['zh-Hans-CN'], 'zh-CN'],
    [['zh-TW'], 'zh-TW'], [['zh-HK'], 'zh-TW'], [['zh-Hant'], 'zh-TW'],
    [['pt-PT'], 'pt-BR'], [['pt-BR'], 'pt-BR'], [['de-AT'], 'de'], [['pl'], 'pl'],
    [['ja-JP'], 'ja'], [['ko-KR'], 'ko'], [['uk-UA'], 'uk'], [['cs-CZ'], 'cs'],
    [['nl-NL', 'fr-BE'], 'fr'], [['it-IT'], 'en'], [[], 'en'],
  ];
  for (const [tags, want] of cases) assert.equal(detectLocale(tags), want, tags.join(','));
});

await test('follows the browser language unless one is chosen in the menu', async () => {
  const s = fakeGist();
  const a = device('A', s, { languages: ['pl-PL', 'en'] });
  assert.equal(await a.x.resolveLang(), 'pl');
  a.gmStore.set('language', 'ja');
  assert.equal(await a.x.resolveLang(), 'ja');
  a.gmStore.set('language', 'auto');
  assert.equal(await a.x.resolveLang(), 'pl');
  a.gmStore.set('language', 'xx');
  assert.equal(await a.x.resolveLang(), 'pl', 'an unknown stored code falls back to the browser');
});

await test('messages come out in the chosen language', async () => {
  const s = fakeGist();
  const a = device('A', s, { confirms: [true] });
  a.save = 'S1';
  await a.x.bootSync();
  const b = device('B', s);
  await b.x.bootSync();
  b.save = 'B-new';
  await b.x.pushIfSafe();
  a.save = 'A-offline';
  a.x.setLang('zh-CN');
  await a.x.bootSync();
  assert.ok(a.dialogs[0].startsWith('[存档同步] 本机和云端的存档都改过'), a.dialogs[0]);
  assert.ok(a.toasts.some((t) => t.startsWith('存档同步 · 已载入云端存档（B，')), a.toasts.join('\n'));
  a.x.setLang('de');
  assert.equal(a.x.t('gamePath'), 'Optionen → Spielstände → Spielstand importieren');
  assert.equal(a.x.t('err.http', { status: 500 }), 'GitHub antwortete mit 500');
});

for (const [mark, name, err] of results) {
  console.log(`${mark === 'ok' ? '✓' : '✗'} ${name}`);
  if (err) console.log(`    ${err.split('\n').slice(0, 4).join('\n    ')}`);
}
const failed = results.filter((r) => r[0] !== 'ok').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
