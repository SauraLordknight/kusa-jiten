const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('index.html');
const legacyEntry = read('kusa_named_directory_final.html');
assert.equal(legacyEntry, index, '旧共有URLの内容が公開トップと異なります');

const rewards = read('kusa-rewards.js');
assert.match(rewards, /const key = 'kusaPachiRewardsV1'/);
assert.match(rewards, /const gachaKey = 'kusa-jiten-gacha-v1'/);
assert.match(index, /const profileKey = 'kusaPachiProfilesV1'/);

const frameCss = read('assets/gacha-frames/frames.css');
for (const [, asset] of frameCss.matchAll(/url\("([^"?#]+)"\)/g)) {
  assert.ok(fs.existsSync(path.join(root, 'assets/gacha-frames', asset)), `カード枠の素材がありません: ${asset}`);
}
for (const [, sound] of index.matchAll(/mode\w+: '([^']+\.ogg)'/g)) {
  assert.ok(fs.existsSync(path.join(root, 'pachi-sounds', sound)), `モード効果音がありません: ${sound}`);
}
assert.match(index, /id: 'history-005', rarity: 'Ω'.*title: 'kusaサーバー'/);
assert.match(index, /\['GODR', 0\.1\], \['Ω', 0\.01\]/, 'Ωの排出率がGODRより低くありません');
assert.match(index, /Ω: \{ label: 'ΩR', name: 'ΩR' \}/);
assert.doesNotMatch(index, /Ωレア|Ω RARE/);
assert.match(frameCss, /rarity-Ω::before\{background-image:url\("omega-obsidian-frame\.png"\)/);
for (const [, script] of index.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
  new vm.Script(script, {filename: 'index.html'});
}

function sourceBetween(start, end) {
  const from = index.indexOf(start);
  const to = index.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `確認対象の処理が見つかりません: ${start}`);
  return index.slice(from, to);
}

const saved = new Map();
const gachaKey = 'kusa-jiten-gacha-v1';
saved.set(gachaKey, JSON.stringify({
  lastDrawAt: 123456,
  obtainedCards: ['grass-001', 'history-003', 'named-R-ロゼ',
    'named-SSR-従来型コーディングガイジ', 'named-SSR-バイブコーディングガイジ'],
  grassPoint: 40
}));
const localStorage = {
  getItem: key => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, value)
};
const legacySsrIds = new Set([
  'named-SSR-従来型コーディングガイジ',
  'named-SSR-バイブコーディングガイジ'
]);
const readGachaState = vm.runInNewContext(
  `${sourceBetween('function readGachaState()', 'function saveGachaState(')}; readGachaState`,
  {localStorage, gachaStorageKey: gachaKey, gachaExcludedLegacySsrIds: legacySsrIds}
);
const gacha = readGachaState();
for (const id of ['grass-001', 'history-003', 'named-R-ロゼ',
  ...legacySsrIds,
  'named-SR-従来型コーディングガイジ', 'named-SR-バイブコーディングガイジ']) {
  assert.ok(gacha.obtainedCards.includes(id), `取得済みカードが保持されません: ${id}`);
}
assert.equal(gacha.grassPoint, 40);
assert.equal(gacha.lastDrawAt, 123456);
assert.deepEqual(JSON.parse(saved.get(gachaKey)).obtainedCards, Array.from(gacha.obtainedCards));

const drawSource = sourceBetween('  function draw(useTicket) {', '  gachaButton.addEventListener(');
function checkTicketDraw({spend, save, refund}) {
  const events = [];
  const drawState = {lastDrawAt: 0, obtainedCards: [], grassPoint: 0};
  const context = {
    state: drawState, pools: {}, allCards: [{id: 'grass-001'}],
    gachaButton: {disabled: false}, gachaTicketButton: {disabled: false}, gachaResult: {textContent: ''},
    updateGachaAvailability: () => drawState,
    chooseGachaCard: () => ({id: 'grass-001'}),
    saveGachaState: () => { events.push('save'); return save; },
    renderGachaCard: () => events.push('render'),
    renderGachaBook: () => events.push('book'),
    window: {KusaRewards: {
      spendTicket: () => { events.push('spend'); return spend; },
      addTicket: () => { events.push('refund'); return {ok: refund}; }
    }}
  };
  vm.runInNewContext(`${drawSource}\ndraw(true)`, context);
  return {events, state: drawState, message: context.gachaResult.textContent};
}
const deniedDraw = checkTicketDraw({spend: false, save: true, refund: true});
assert.deepEqual(deniedDraw.events, ['spend'], 'ガチャ券を使えない時にカードを保存しました');
assert.equal(deniedDraw.state.obtainedCards.length, 0);
const failedDraw = checkTicketDraw({spend: true, save: false, refund: true});
assert.deepEqual(failedDraw.events, ['spend', 'save', 'refund'], 'カード保存失敗時に券を返却できません');
assert.ok(!failedDraw.events.includes('render'));
const successfulDraw = checkTicketDraw({spend: true, save: true, refund: true});
assert.deepEqual(successfulDraw.events, ['spend', 'save', 'render', 'book']);
assert.deepEqual(Array.from(successfulDraw.state.obtainedCards), ['grass-001']);

const normalizeProfile = vm.runInNewContext(
  `${sourceBetween('function validCount(', 'function readSound(')}; normalizeProfile`,
  {
    titleCatalog: [{id: 'beginner'}],
    rushBonusSpins: 15,
    jackpotAmounts: {1: 100000, 5: 300000, 10: 500000},
    scenes: ['normal', 'night', 'festival', 'yaminabe', 'puyuyu'],
    sceneCycleSpins: 15
  }
);
const profile = normalizeProfile({
  name: '既存プレイヤー', balls: 12345, grass: 678, wager: 5,
  spins: 99, hits: 4, inFlight: 2, inFlightValue: 10,
  pendingJackpot: 3000, jackpotRate: 5
});
assert.equal(profile.balls, 12345);
assert.equal(profile.grass, 678);
assert.equal(profile.inFlightValue, 10);
assert.equal(profile.pendingJackpot, 3000);
assert.equal(profile.spins, 99);
assert.equal(profile.hits, 4);

console.log('公開ファイル・素材・既存保存データの互換性: OK');
