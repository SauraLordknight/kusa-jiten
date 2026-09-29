(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const shell = $('kusa-pachi');
  if (!shell) return;
  const rewards = window.KusaRewards;
  if (!rewards) return;
  const panel = $('pachiPanel');
  const canvas = $('pachiCanvas');
  const sceneryCtx = canvas.getContext('2d');
  const ctx = $('pachiBallsCanvas')?.getContext('2d');
  if (!sceneryCtx || !ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  const ballSprites = new Map();
  const mobileLite = window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 560;
  const frameInterval = mobileLite ? 1000 / 30 : 1000 / 60;
  const pegSoundGap = mobileLite ? 180 : 95;
  const faces = ['😄', '😆', '😊', '😎', '🤩', '🥳', '😏', '😲', '😺', '🤠', '🥹', '😋', '😠', '😡', '🤓', '🥺'];
  const reelFaces = ['🌱', '🌿', '🍀', '🌻', '🌳', '✨'];
  const profileKey = 'kusaPachiProfilesV1';
  const soundKey = 'kusaPachiSoundV1';
  const jackpotAmounts = {1: 100000, 5: 300000, 10: 500000};
  const jackpotOdds = 20000;
  const pocketPayout = 2;
  const hitPayout = 80;
  const premiumPayout = 250;
  const rushSpins = 10;
  const chuteTipY = 40;
  function chuteX(y) {
    const bend = Math.max(0, Math.min(1, (92 - y) / (92 - chuteTipY)));
    return 409 - 52 * bend * bend * (3 - 2 * bend);
  }
  const guideRails = [
    {x1: 135, y1: 366, x2: 185, y2: 454, side: 1},
    {x1: 305, y1: 366, x2: 255, y2: 454, side: -1}
  ];
  const pegs = [];
  const pegRows = Array.from({length: 12}, () => []);
  for (let row = 0; row < 12; row++) {
    const y = 111 + row * 31;
    // 外壁とのすき間に球が挟まらないよう、端の釘を内側へ寄せる。
    const offset = row % 2 ? 76 : 57;
    for (let x = offset; x < 363; x += 38) {
      if (y >= 204 && y <= 359 && x > 90 && x < 360) continue;
      if (y >= 365 && guideRails.some(rail => {
        const railX = rail.x1 + (rail.x2 - rail.x1) * (y - rail.y1) / (rail.y2 - rail.y1);
        return Math.abs(x - railX) < 40;
      })) continue;
      if (y >= 452 && x > 195 && x < 245) continue;
      const peg = {x, y, r: 3.8};
      pegs.push(peg);
      pegRows[row].push(peg);
    }
  }
  const pockets = [
    {x: 74, y: 506, r: 18, type: 'side'},
    {x: 220, y: 506, r: 21, type: 'start'},
    {x: 366, y: 506, r: 18, type: 'side'}
  ];
  let profiles = readProfiles();
  let player = null;
  let balls = [];
  let soundOn = readSound();
  const soundFiles = {
    launch: 'launch.wav', pegA: 'peg-a.wav', pegB: 'peg-b.wav', pegC: 'peg-c.wav',
    start: 'start.wav', jackpot: 'jackpot.wav', drain: 'drain.wav'
  };
  const audioBuffers = {};
  const audioLoading = {};
  const fallbackAudio = {};
  const activeSounds = new Set();
  let soundContext = null;
  let soundContextUnavailable = false;
  let firing = false;
  let fireTimer = 0;
  let lastFire = 0;
  let lastFrame = 0;
  let frameId = 0;
  let spinQueue = [];
  let spinning = false;
  let spinTimer = 0;
  let reelTimer = 0;
  let announceTimer = 0;
  let lastPegSound = 0;
  let lastDrainSound = 0;
  let payoutActive = false;
  let payoutFinishTimer = 0;
  let payoutTotal = 0;
  let lastPayoutSound = 0;

  function readProfiles() {
    try {
      const parsed = JSON.parse(localStorage.getItem(profileKey) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(p => p && typeof p.name === 'string' && p.name.trim() && p.name.length <= 20)
        .map(p => ({
          name: p.name, balls: validCount(p.balls, 250), grass: validCount(p.grass), wager: validWager(p.wager), spins: validCount(p.spins),
          hits: validCount(p.hits), streak: validCount(p.streak), bestStreak: validCount(p.bestStreak),
          rushLeft: Math.min(validCount(p.rushLeft), rushSpins), lastBonusDay: typeof p.lastBonusDay === 'string' ? p.lastBonusDay : '',
          inFlight: validCount(p.inFlight), inFlightValue: validCount(p.inFlightValue, validCount(p.inFlight)),
          pendingJackpot: validCount(p.pendingJackpot), jackpotRate: validWager(p.jackpotRate),
          jackpotTotal: validCount(p.jackpotTotal, Math.ceil(validCount(p.pendingJackpot) / jackpotAmounts[validWager(p.jackpotRate)]) * jackpotAmounts[validWager(p.jackpotRate)])
        }));
    } catch { return []; }
  }
  function validCount(value, fallback = 0) {
    return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 100000000) : fallback;
  }
  function validWager(value) { return [1, 5, 10].includes(Number(value)) ? Number(value) : 1; }
  function readSound() {
    try { return localStorage.getItem(soundKey) !== 'off'; } catch { return true; }
  }
  function saveProfiles() {
    if (!player) return false;
    try {
      localStorage.setItem(profileKey, JSON.stringify(profiles));
      const message = '持ち球・草・ガチャ券は自動保存されています。端末のデータを消す前にバックアップを残してください。';
      if ($('pachiSaveMessage').textContent !== message) $('pachiSaveMessage').textContent = message;
      return true;
    } catch {
      $('pachiSaveMessage').textContent = 'このブラウザでは保存できません。設定を確認してください。';
      return false;
    }
  }
  function today() {
    const date = new Date();
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }
  function getSoundContext() {
    if (soundContext || soundContextUnavailable) return soundContext;
    const AudioContextType = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextType) { soundContextUnavailable = true; return null; }
    try { soundContext = new AudioContextType(); }
    catch { soundContextUnavailable = true; }
    return soundContext;
  }
  function unlockAudio() {
    const ac = getSoundContext();
    if (soundOn && ac && ac.state !== 'running') ac.resume().catch(() => {});
  }
  function initAudio() {
    const ac = getSoundContext();
    if (!ac || typeof fetch !== 'function') return;
    for (const [kind, file] of Object.entries(soundFiles)) {
      audioLoading[kind] = true;
      fetch(`pachi-sounds/${file}`)
        .then(response => {
          if (!response.ok) throw new Error('Sound unavailable');
          return response.arrayBuffer();
        })
        .then(data => ac.decodeAudioData(data))
        .then(buffer => { audioBuffers[kind] = buffer; })
        .catch(() => { /* file:// などで読めなければ Audio 要素を使う */ })
        .finally(() => { audioLoading[kind] = false; });
    }
  }
  function trackSound(source, gain, kind = '') {
    const sound = {source, gain, kind};
    activeSounds.add(sound);
    source.onended = () => {
      activeSounds.delete(sound);
      source.disconnect();
      gain.disconnect();
    };
  }
  function playSound(kind, volume = .22) {
    if (!soundOn) return;
    const ac = getSoundContext();
    const buffer = audioBuffers[kind];
    const rate = kind.startsWith('peg') ? 1.02 + Math.random() * .13
      : kind === 'launch' ? 1.02 + Math.random() * .06 : 1;
    if (ac && buffer) {
      if (kind.startsWith('peg')) {
        if (activeSounds.size >= (mobileLite ? 5 : 8)) return;
        let pegVoices = 0;
        for (const sound of activeSounds) if (sound.kind.startsWith('peg')) pegVoices++;
        if (pegVoices >= (mobileLite ? 2 : 4)) return;
      }
      try {
        const source = ac.createBufferSource();
        const gain = ac.createGain();
        source.buffer = buffer;
        source.playbackRate.value = rate;
        gain.gain.value = volume;
        source.connect(gain).connect(ac.destination);
        source.start();
        trackSound(source, gain, kind);
      } catch { /* 音声が無効でもゲームは続ける */ }
      return;
    }
    if (audioLoading[kind]) return;
    try {
      const audio = fallbackAudio[kind] ||= new Audio(`pachi-sounds/${soundFiles[kind]}`);
      audio.pause();
      if (audio.readyState >= 1) audio.currentTime = 0;
      audio.playbackRate = rate;
      audio.volume = volume;
      audio.play().catch(() => {});
    } catch { /* ローカルファイルなどで音声が使えなくても続ける */ }
  }
  function stopSounds() {
    for (const {source, gain} of activeSounds) {
      try { source.stop(); } catch { /* 再生終了済み */ }
      source.disconnect(); gain.disconnect();
    }
    activeSounds.clear();
    Object.values(fallbackAudio).forEach(audio => audio.pause());
  }
  function playTick(frequency = 820, volume = .035) {
    if (!soundOn) return;
    const ac = getSoundContext();
    if (!ac) return;
    try {
      const oscillator = ac.createOscillator(), gain = ac.createGain();
      oscillator.type = 'square'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + .055);
      oscillator.connect(gain).connect(ac.destination);
      oscillator.start(); trackSound(oscillator, gain); oscillator.stop(ac.currentTime + .06);
    } catch { /* 音声合成が使えない場合は実機録音だけ流す */ }
  }
  function playChime(premium = false) {
    if (!soundOn) return;
    const ac = getSoundContext();
    if (!ac) return;
    try {
      const notes = premium ? [523, 659, 784, 1047] : [523, 659, 784];
      notes.forEach((frequency, i) => {
        const oscillator = ac.createOscillator();
        const gain = ac.createGain();
        oscillator.type = 'sine'; oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(.0001, ac.currentTime + i * .105);
        gain.gain.exponentialRampToValueAtTime(.11, ac.currentTime + i * .105 + .015);
        gain.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + i * .105 + .28);
        oscillator.connect(gain).connect(ac.destination);
        oscillator.start(ac.currentTime + i * .105);
        trackSound(oscillator, gain);
        oscillator.stop(ac.currentTime + i * .105 + .29);
      });
    } catch { /* ブラウザが音声合成を制限した場合は無音で進める */ }
  }
  function announce(message, duration = 0) {
    if ((payoutActive || payoutFinishTimer) && !message.includes('ジャックポット')) return;
    $('pachiAnnouncement').textContent = message;
    clearTimeout(announceTimer);
    if (duration) announceTimer = setTimeout(() => {
      if (!spinning && !payoutActive && !payoutFinishTimer) $('pachiAnnouncement').textContent = '中央のスタートチャッカーを狙おう！';
    }, duration);
  }
  function renderProfiles() {
    const area = $('pachiProfiles');
    area.replaceChildren();
    profiles.slice().reverse().forEach(profile => {
      const item = document.createElement('div');
      item.className = 'pachi-profile-item';
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'pachi-profile-select';
      select.textContent = `${profile.name} · ${(profile.balls + profile.inFlightValue).toLocaleString('ja-JP')}球 · ${profile.grass.toLocaleString('ja-JP')}草${profile.pendingJackpot ? `（JP残り${profile.pendingJackpot.toLocaleString('ja-JP')}球）` : ''}`;
      select.addEventListener('click', () => { $('pachiName').value = profile.name; startPlayer(); });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'pachi-profile-delete';
      remove.textContent = '削除';
      remove.setAttribute('aria-label', `${profile.name}のプレイヤーデータを削除`);
      remove.addEventListener('click', () => deleteProfile(profile));
      item.append(select, remove);
      area.appendChild(item);
    });
  }
  function deleteProfile(profile) {
    if (!profiles.includes(profile)) return;
    if (!window.confirm(`「${profile.name}」の持ち球・草・回転数・大当たり記録・未払い賞球を削除します。元に戻せません。よろしいですか？`)) return;
    const remaining = profiles.filter(entry => entry.name !== profile.name);
    try {
      localStorage.setItem(profileKey, JSON.stringify(remaining));
    } catch {
      $('pachiEntryMessage').textContent = '保存できなかったため、プレイヤーデータは削除していません。ブラウザの設定を確認してください。';
      return;
    }
    profiles = remaining;
    if ($('pachiName').value.trim() === profile.name) $('pachiName').value = '';
    $('pachiEntryMessage').textContent = `「${profile.name}」のプレイヤーデータを削除しました。`;
    renderProfiles();
  }
  function updateUI() {
    if (!player) return;
    $('pachiPlayer').textContent = player.name;
    for (const input of document.querySelectorAll('input[name="pachiWager"]')) input.checked = Number(input.value) === player.wager;
    $('pachiWagerNote').textContent = `1発${player.wager}球消費・残り${Math.floor(player.balls / player.wager).toLocaleString('ja-JP')}発${player.pendingJackpot ? '（JP中は倍率固定）' : ''}`;
    $('pachiWager').disabled = !!player.pendingJackpot || !!payoutFinishTimer || balls.length > 0;
    $('pachiBalls').textContent = player.balls.toLocaleString('ja-JP');
    $('pachiSpins').textContent = player.spins.toLocaleString('ja-JP');
    $('pachiHits').textContent = player.hits.toLocaleString('ja-JP');
    $('pachiStreak').textContent = player.streak.toLocaleString('ja-JP');
    $('pachiMode').textContent = player.rushLeft > 0 ? `🔥 草ラッシュ 残り${player.rushLeft}回転` : '🌿 通常モード';
    $('pachiDaily').disabled = player.lastBonusDay === today();
    $('pachiDaily').textContent = $('pachiDaily').disabled ? '🎁 今日の補充は受取済み' : '🎁 今日の補充 +50球';
    $('pachiFire').disabled = (player.balls < player.wager && player.pendingJackpot === 0) || (player.pendingJackpot > 0 && !payoutActive) || !!payoutFinishTimer;
    $('pachiSignal').textContent = player.pendingJackpot > 0 ? '👑 JACKPOT 払い出し中！'
      : player.rushLeft > 0 ? '✨ 大当たり高確率！' : '🌱 チャンスを待とう';
    updateExchangeUI();
  }
  function updateExchangeUI(state = rewards.read()) {
    if (!player) return;
    const remaining = Math.max(0, rewards.exchangeCost - player.grass);
    $('pachiWalletBalls').textContent = player.balls.toLocaleString('ja-JP');
    $('pachiWalletGrass').textContent = player.grass.toLocaleString('ja-JP');
    $('pachiExchangeProgress').textContent = player.grass.toLocaleString('ja-JP');
    $('pachiExchangeRemaining').textContent = remaining.toLocaleString('ja-JP');
    $('pachiExchangeTickets').textContent = state.tickets.toLocaleString('ja-JP');
    $('pachiExchangeBar').value = Math.min(player.grass, rewards.exchangeCost);
    $('pachiExchangeButton').disabled = player.grass < rewards.exchangeCost;
    const amount = Number($('pachiGrassAmount').value);
    const valid = Number.isSafeInteger(amount) && amount > 0 && amount <= player.balls && player.grass + amount <= 100000000;
    $('pachiConvertButton').disabled = !valid;
    $('pachiConvertPreview').textContent = !Number.isSafeInteger(amount) || amount <= 0
      ? '交換する球数を入力してください。'
      : amount > player.balls ? '持ち球が足りません。'
      : player.grass + amount > 100000000 ? '所持草の上限を超えます。'
      : `${amount.toLocaleString('ja-JP')}球 → ${amount.toLocaleString('ja-JP')}草（交換後 ${Math.floor((player.balls - amount) / player.wager).toLocaleString('ja-JP')}発）`;
    const returnAmount = Number($('pachiBallAmount').value);
    const validReturn = Number.isSafeInteger(returnAmount) && returnAmount > 0 && returnAmount <= player.grass && player.balls + returnAmount <= 100000000;
    $('pachiReturnButton').disabled = !validReturn;
    $('pachiReturnPreview').textContent = !Number.isSafeInteger(returnAmount) || returnAmount <= 0
      ? '球に戻す草の数を入力してください。'
      : returnAmount > player.grass ? '所持草が足りません。'
      : player.balls + returnAmount > 100000000 ? '持ち球の上限を超えます。'
      : `${returnAmount.toLocaleString('ja-JP')}草 → ${returnAmount.toLocaleString('ja-JP')}球（交換後 ${Math.floor((player.balls + returnAmount) / player.wager).toLocaleString('ja-JP')}発）`;
  }
  function updateBallCount() {
    $('pachiBalls').textContent = player.balls.toLocaleString('ja-JP');
    $('pachiFire').disabled = (player.balls < player.wager && player.pendingJackpot === 0) || (player.pendingJackpot > 0 && !payoutActive) || !!payoutFinishTimer;
    $('pachiWagerNote').textContent = `1発${player.wager}球消費・残り${Math.floor(player.balls / player.wager).toLocaleString('ja-JP')}発${player.pendingJackpot ? '（JP中は倍率固定）' : ''}`;
    updateExchangeUI();
  }
  function startPlayer() {
    const name = $('pachiName').value.trim().replace(/\s+/g, ' ').slice(0, 20);
    if (!name) { $('pachiEntryMessage').textContent = 'プレイヤーネームを入力してください。'; $('pachiName').focus(); return; }
    unlockAudio();
    const existing = profiles.find(p => p.name === name);
    player = existing || {name, balls: 250, grass: 0, wager: 1, spins: 0, hits: 0, streak: 0, bestStreak: 0, rushLeft: 0, lastBonusDay: '', inFlight: 0, inFlightValue: 0, pendingJackpot: 0, jackpotRate: 1, jackpotTotal: 0};
    if (!existing) profiles.push(player);
    if (player.inFlight) { player.balls += player.inFlightValue; player.inFlight = 0; player.inFlightValue = 0; }
    $('pachiEntry').hidden = true;
    $('pachiGame').hidden = false;
    $('pachiGrassAmount').value = '';
    $('pachiBallAmount').value = '';
    balls = [];
    drawBoard();
    spinQueue = [];
    spinning = false;
    clearTimeout(spinTimer); clearInterval(reelTimer);
    $('pachiReels').classList.remove('is-spinning');
    $('pachiReels').children[0].textContent = '🌱';
    $('pachiReels').children[1].textContent = '🌿';
    $('pachiReels').children[2].textContent = '🍀';
    announce(`ようこそ、${name}さん！ ハンドルを調整して発射！`);
    saveProfiles(); updateUI(); playSound('start', .16); playTick(740, .018);
    startLoop();
    if (player.pendingJackpot > 0) startPayout();
  }
  function stopFiring() { firing = false; clearInterval(fireTimer); fireTimer = 0; $('pachiMachine').classList.remove('is-firing-jp'); }
  function switchPlayer() {
    stopFiring();
    closeShare();
    pausePayout();
    clearTimeout(spinTimer); clearInterval(reelTimer);
    if (player) {
      player.balls += balls.reduce((total, ball) => total + ball.wager, 0);
      player.inFlight = 0;
      player.inFlightValue = 0;
      balls = [];
      saveProfiles();
    }
    player = null; spinQueue = []; spinning = false;
    $('pachiGame').hidden = true;
    $('pachiEntry').hidden = false;
    renderProfiles();
  }
  function fire() {
    if (!player || (player.balls < player.wager && player.pendingJackpot <= 0) || (player.pendingJackpot > 0 && !payoutActive) || payoutFinishTimer || balls.length >= 22 || panel.hidden) {
      if (player && ((player.balls < player.wager && player.pendingJackpot <= 0) || (player.pendingJackpot > 0 && !payoutActive) || payoutFinishTimer)) stopFiring();
      return;
    }
    const power = Number($('pachiPower').value) / 100;
    const priorBalls = player.balls, priorPending = player.pendingJackpot, priorInFlight = player.inFlight, priorInFlightValue = player.inFlightValue;
    const jackpotPayout = Math.min(jackpotAmounts[player.jackpotRate] / 50, player.pendingJackpot);
    player.balls += jackpotPayout - player.wager;
    player.pendingJackpot -= jackpotPayout;
    player.inFlight++;
    player.inFlightValue += player.wager;
    balls.push({x: chuteX(536), y: 536, vx: 0, vy: -690 - power * 210, r: 9.5, power,
      wager: player.wager,
      face: faces[Math.floor(Math.random() * faces.length)], phase: 'chute', age: 0,
      stallX: 409, stallY: 536, stallTime: 0});
    if (!saveProfiles()) {
      player.balls = priorBalls; player.pendingJackpot = priorPending; player.inFlight = priorInFlight; player.inFlightValue = priorInFlightValue;
      balls.pop(); stopFiring(); updateUI();
      return;
    }
    startLoop();
    updateBallCount(); playSound('launch', .19);
    $('pachiWager').disabled = true;
    if (jackpotPayout) {
      updatePayoutDisplay();
      if (performance.now() - lastPayoutSound > 600) { playSound('pegB', .09); lastPayoutSound = performance.now(); }
      if (player.pendingJackpot === 0) finishPayout();
    }
  }
  function startFiring() {
    if (firing) return;
    unlockAudio();
    firing = true;
    if (player?.pendingJackpot > 0) $('pachiMachine').classList.add('is-firing-jp');
    fire();
    if (!firing) return;
    fireTimer = setInterval(() => {
      if (!firing) return;
      if (performance.now() - lastFire >= 185) { fire(); lastFire = performance.now(); }
    }, 185);
  }
  function collidePeg(ball, peg) {
    const dx = ball.x - peg.x, dy = ball.y - peg.y;
    const min = ball.r + peg.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min || d2 < .0001) return;
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
    ball.x += nx * (min - d + .2); ball.y += ny * (min - d + .2);
    const approach = ball.vx * nx + ball.vy * ny;
    if (approach < 0) {
      ball.vx -= 1.7 * approach * nx;
      ball.vy -= 1.7 * approach * ny;
      ball.vx += (Math.random() - .5) * 25;
      if (performance.now() - lastPegSound > pegSoundGap) {
        const pegSound = ['pegA', 'pegB', 'pegC'][Math.floor(Math.random() * 3)];
        playSound(pegSound, Math.min(.12, .03 + -approach / 2600));
        lastPegSound = performance.now();
      }
    }
  }
  function collideBumper(ball) {
    const dx = ball.x - 220, dy = ball.y - 277;
    const rx = 95 + ball.r, ry = 72 + ball.r;
    const distance = (dx / rx) ** 2 + (dy / ry) ** 2;
    if (distance >= 1) return;
    if (distance < .000001) {
      ball.x = 220 + (ball.vx < 0 ? -rx : rx);
      ball.y = 277;
    } else {
      const scale = 1.004 / Math.sqrt(distance);
      ball.x = 220 + dx * scale;
      ball.y = 277 + dy * scale;
    }
    const normalX = (ball.x - 220) / (rx * rx), normalY = (ball.y - 277) / (ry * ry);
    const normalLength = Math.hypot(normalX, normalY);
    const nx = normalX / normalLength, ny = normalY / normalLength;
    const approach = ball.vx * nx + ball.vy * ny;
    if (approach < 0) {
      ball.vx -= 1.72 * approach * nx; ball.vy -= 1.72 * approach * ny;
      if (performance.now() - lastPegSound > 95) {
        playSound('pegC', Math.min(.14, .04 + -approach / 2400));
        lastPegSound = performance.now();
      }
    }
    // リール窓の上で球が釣り合わないよう、左右どちらかに流す。
    if (dy < -52 && Math.abs(dx) < 32) {
      const side = Math.sign(dx || ball.vx || ball.power - .65 || 1);
      ball.vx += side * 26;
    }
  }
  function collideGuide(ball, rail) {
    const vx = rail.x2 - rail.x1, vy = rail.y2 - rail.y1;
    const t = Math.max(0, Math.min(1, ((ball.x - rail.x1) * vx + (ball.y - rail.y1) * vy) / (vx * vx + vy * vy)));
    const nearestX = rail.x1 + t * vx, nearestY = rail.y1 + t * vy;
    const dx = ball.x - nearestX, dy = ball.y - nearestY;
    const min = ball.r + 4;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared >= min * min) return;
    const distance = Math.sqrt(distanceSquared);
    const nx = distance > .001 ? dx / distance : rail.side * vy / Math.hypot(vx, vy);
    const ny = distance > .001 ? dy / distance : -Math.abs(vx) / Math.hypot(vx, vy);
    ball.x += nx * (min - distance + .2);
    ball.y += ny * (min - distance + .2);
    const approach = ball.vx * nx + ball.vy * ny;
    if (approach < 0) {
      ball.vx -= 1.55 * approach * nx;
      ball.vy -= 1.55 * approach * ny;
      if (performance.now() - lastPegSound > 95) {
        playSound('pegB', Math.min(.12, .03 + -approach / 2800));
        lastPegSound = performance.now();
      }
    }
  }
  function keepBallMoving(ball, dt) {
    if (Math.hypot(ball.x - ball.stallX, ball.y - ball.stallY) > 8) {
      ball.stallX = ball.x; ball.stallY = ball.y; ball.stallTime = 0;
      return;
    }
    ball.stallTime += dt;
    if (ball.stallTime < .75) return;
    const side = ball.x < 65 ? 1 : ball.x > 355 ? -1 : Math.sign(ball.x - 220 || ball.vx || 1);
    ball.vx = side * Math.max(90, Math.abs(ball.vx));
    ball.vy = Math.max(35, ball.vy);
    ball.x += side * 2;
    ball.stallX = ball.x; ball.stallY = ball.y; ball.stallTime = 0;
  }
  function settleBall(ball, type) {
    const index = balls.indexOf(ball);
    if (index !== -1) balls.splice(index, 1);
    if (!player) return;
    player.inFlight = Math.max(0, player.inFlight - 1);
    player.inFlightValue = Math.max(0, player.inFlightValue - ball.wager);
    if (type === 'side') {
      player.balls += pocketPayout * ball.wager;
      announce(`入賞！ ${pocketPayout * ball.wager}球戻りました。`, 1300);
      playSound('start', .16);
    } else if (type === 'start') {
      player.balls += pocketPayout * ball.wager;
      player.spins++;
      playSound('start', .22);
      playTick(1050, .045);
      const rush = player.rushLeft > 0;
      if (rush) player.rushLeft--;
      const jackpot = Math.random() < 1 / jackpotOdds;
      const jackpotExtension = jackpot && (player.pendingJackpot > 0 || !!payoutFinishTimer);
      const roll = Math.random();
      const premium = !jackpot && roll < (rush ? .008 : .003);
      const hit = jackpot || premium || roll < (rush ? .13 : .045);
      if (hit) {
        player.hits++;
        player.streak = rush ? player.streak + 1 : 1;
        player.bestStreak = Math.max(player.bestStreak, player.streak);
        if (jackpot) {
          if (jackpotExtension && payoutFinishTimer) { clearTimeout(payoutFinishTimer); payoutFinishTimer = 0; }
          if (!jackpotExtension) { player.jackpotTotal = 0; player.jackpotRate = ball.wager; }
          const award = jackpotAmounts[ball.wager];
          player.pendingJackpot += award;
          player.jackpotTotal += award;
          payoutTotal = player.jackpotTotal;
        } else player.balls += (premium ? premiumPayout : hitPayout) * ball.wager;
        player.rushLeft = rushSpins;
      } else if (rush && player.rushLeft === 0) player.streak = 0;
      if (jackpotExtension) announce(`👑 ジャックポット上乗せ！ さらに${jackpotAmounts[ball.wager].toLocaleString('ja-JP')}球！`);
      else {
        spinQueue.push({hit, premium, jackpot, rush, wager: ball.wager});
        if (!spinning) runSpin();
      }
    } else if (performance.now() - lastDrainSound > 240) {
      playSound('drain', .14);
      lastDrainSound = performance.now();
    }
    saveProfiles(); updateUI();
    if (payoutActive && player.pendingJackpot > 0) updatePayoutDisplay();
  }
  function step(dt) {
    if (!player) return;
    for (const ball of [...balls]) {
      ball.age += dt;
      if (ball.phase === 'chute') {
        ball.y += ball.vy * dt;
        ball.x = chuteX(ball.y);
        if (ball.y <= chuteTipY) {
          ball.y = chuteTipY; ball.x = chuteX(chuteTipY); ball.phase = 'field';
          ball.vx = -95 - ball.power * 420 + (Math.random() - .5) * 14;
          ball.vy = 10;
        }
        continue;
      }
      ball.vy = Math.min(490, ball.vy + 750 * dt);
      ball.vx *= Math.pow(.998, dt * 60);
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      if (ball.x < 24 + ball.r) { ball.x = 24 + ball.r; ball.vx = Math.abs(ball.vx) * .68; }
      if (ball.x > 390 - ball.r) { ball.x = 390 - ball.r; ball.vx = -Math.abs(ball.vx) * .68; }
      if (ball.y < 26 + ball.r) { ball.y = 26 + ball.r; ball.vy = Math.abs(ball.vy) * .55; }
      const row = Math.round((ball.y - 111) / 31);
      if (row >= 0 && row < pegRows.length) {
        for (const peg of pegRows[row]) {
          if (Math.abs(ball.y - peg.y) < 15 && Math.abs(ball.x - peg.x) < 15) collidePeg(ball, peg);
        }
      }
      collideBumper(ball);
      if (ball.y >= 348 && ball.y <= 488) for (const rail of guideRails) collideGuide(ball, rail);
      keepBallMoving(ball, dt);
      if (ball.vy > 0 && ball.y > 491 && ball.y < 529) {
        const pocket = pockets.find(p => Math.abs(ball.x - p.x) < p.r && Math.abs(ball.y - p.y) < p.r);
        if (pocket) { settleBall(ball, pocket.type); continue; }
      }
      if (ball.y > 548 || ball.age > 15) settleBall(ball, 'out');
    }
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (a.phase !== 'field') continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (b.phase !== 'field') continue;
        const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r;
        if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue;
        const distance = Math.hypot(dx, dy);
        if (distance >= min || distance < .001) continue;
        const nx = dx / distance, ny = dy / distance, overlap = (min - distance) / 2;
        a.x -= nx * overlap; a.y -= ny * overlap;
        b.x += nx * overlap; b.y += ny * overlap;
        const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (relative < 0) {
          const impulse = -1.72 * relative / 2;
          a.vx -= impulse * nx; a.vy -= impulse * ny;
          b.vx += impulse * nx; b.vy += impulse * ny;
          if (relative < -55 && performance.now() - lastPegSound > pegSoundGap) {
            playSound('pegA', Math.min(.10, .025 + -relative / 3000));
            lastPegSound = performance.now();
          }
        }
      }
    }
  }
  function updatePayoutDisplay() {
    const remaining = player?.pendingJackpot || 0;
    payoutTotal = player?.jackpotTotal || jackpotAmounts[1];
    $('pachiJackpotPaid').textContent = Math.max(0, payoutTotal - remaining).toLocaleString('ja-JP');
    $('pachiJackpotTotal').textContent = payoutTotal.toLocaleString('ja-JP');
    $('pachiJackpotBar').max = Math.max(1, payoutTotal);
    $('pachiJackpotBar').value = Math.max(0, payoutTotal - remaining);
  }
  function stopPayoutDisplay() {
    clearTimeout(payoutFinishTimer);
    payoutFinishTimer = 0;
    payoutActive = false;
    $('pachiMachine').classList.remove('is-jackpot');
    $('pachiMachine').classList.remove('is-firing-jp');
    $('pachiJackpot').hidden = true;
  }
  function startPayout() {
    if (!player || player.pendingJackpot <= 0 || payoutActive) return;
    clearTimeout(payoutFinishTimer);
    payoutFinishTimer = 0;
    payoutTotal = player.jackpotTotal || jackpotAmounts[player.jackpotRate];
    stopFiring();
    $('pachiJackpotTitle').textContent = `${player.jackpotRate}草パチ・発射1球につき${(jackpotAmounts[player.jackpotRate] / 50).toLocaleString('ja-JP')}球！`;
    $('pachiJackpot').hidden = false;
    $('pachiMachine').classList.add('is-jackpot');
    payoutActive = true;
    for (const span of $('pachiReels').children) span.textContent = '7️⃣';
    updatePayoutDisplay();
    updateUI();
    announce('👑 ジャックポット！ 球を発射するほど賞球が増える！');
  }
  function finishPayout() {
    stopFiring();
    updatePayoutDisplay();
    announce(`👑 ジャックポット完走！ +${payoutTotal.toLocaleString('ja-JP')}球！`, 4500);
    playChime(true);
    payoutFinishTimer = setTimeout(() => { stopPayoutDisplay(); updateUI(); runSpin(); }, 1800);
    updateUI();
  }
  function pausePayout() {
    if (!player) return;
    stopPayoutDisplay();
    saveProfiles();
    updateUI();
  }
  function runSpin() {
    if (spinning || payoutActive || payoutFinishTimer || !spinQueue.length || !player) return;
    spinning = true;
    updateUI();
    const result = spinQueue.shift();
    const reels = $('pachiReels');
    reels.classList.add('is-spinning');
    announce(result.jackpot ? '👑 ジャックポットの気配！' : result.hit ? 'リーチ！ 草むらがざわついている…' : '図柄回転中…');
    let reelTicks = 0;
    reelTimer = setInterval(() => {
      for (const span of reels.children) span.textContent = reelFaces[Math.floor(Math.random() * reelFaces.length)];
      if (++reelTicks % 3 === 0) playTick(result.hit ? 980 : 760, .022);
    }, 105);
    spinTimer = setTimeout(() => {
      clearInterval(reelTimer);
      reels.classList.remove('is-spinning');
      if (result.jackpot) {
        for (const span of reels.children) span.textContent = '7️⃣';
        playSound('jackpot', .42);
        playChime(true);
        startPayout();
      } else if (result.hit) {
        const face = result.premium ? '🍀' : '🌿';
        for (const span of reels.children) span.textContent = face;
        announce(result.premium ? `🌈 超大当たり！ +${premiumPayout * result.wager}球！ 草ラッシュ突入！` : `🎉 大当たり！ +${hitPayout * result.wager}球！ 草ラッシュ突入！`, 3600);
        playSound('jackpot', .36);
        playChime(result.premium);
        $('pachiBoardFlash').classList.remove('is-flashing');
        void $('pachiBoardFlash').offsetWidth;
        $('pachiBoardFlash').classList.add('is-flashing');
      } else {
        playTick(540, .02);
        reels.children[0].textContent = '🌱';
        reels.children[1].textContent = '🌿';
        reels.children[2].textContent = '🌱';
        announce('おしい！ 次の入賞を狙おう。', 1500);
      }
      spinning = false;
      updateUI();
      spinTimer = setTimeout(runSpin, result.jackpot ? 600 : result.hit ? 1600 : 420);
    }, result.hit ? 1550 : 850);
  }
  function drawBoardScenery() {
    const ctx = sceneryCtx;
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, '#0b3b38'); gradient.addColorStop(.52, '#145445'); gradient.addColorStop(1, '#093728');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(144,209,150,.11)';
    ctx.beginPath(); ctx.arc(219, 156, 102, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(190,236,170,.09)';
    ctx.beginPath(); ctx.moveTo(21, 238); ctx.quadraticCurveTo(110, 154, 214, 234); ctx.quadraticCurveTo(316, 152, 398, 244); ctx.lineTo(398, 355); ctx.lineTo(21, 355); ctx.fill();
    ctx.fillStyle = 'rgba(8,43,32,.33)';
    ctx.beginPath(); ctx.moveTo(22, 441); ctx.quadraticCurveTo(126, 350, 226, 431); ctx.quadraticCurveTo(321, 369, 398, 439); ctx.lineTo(398, 540); ctx.lineTo(22, 540); ctx.fill();
    ctx.strokeStyle = 'rgba(137,221,129,.21)'; ctx.lineWidth = 3;
    for (let x = 36; x < 405; x += 22) {
      ctx.beginPath(); ctx.moveTo(x, 551); ctx.quadraticCurveTo(x - 11, 516 - x % 20, x - 5, 489 - x % 14); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, 551); ctx.quadraticCurveTo(x + 12, 522, x + 7, 506 - x % 18); ctx.stroke();
    }
    ctx.save();
    ctx.globalAlpha = .13; ctx.strokeStyle = '#c7f5ae'; ctx.lineWidth = 1;
    for (let i = -H; i < W + H; i += 32) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H, H); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = '#347a4f'; ctx.beginPath(); ctx.ellipse(220, 560, 180, 43, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#eaca75'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(18, 532); ctx.lineTo(18, 87); ctx.quadraticCurveTo(23, 21, 90, 20); ctx.lineTo(374, 20); ctx.quadraticCurveTo(399, 22, 401, 50); ctx.lineTo(401, 543); ctx.stroke();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#315d48'; ctx.lineWidth = 7;
    ctx.beginPath();
    for (let y = 530; y >= chuteTipY; y -= 4) {
      const x = chuteX(y) - 17;
      if (y === 530) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineTo(chuteX(chuteTipY) - 17, chuteTipY); ctx.stroke();
    ctx.strokeStyle = '#c8d8b5'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#dcf6cc'; ctx.font = '900 20px system-ui'; ctx.fillText('🌿 草むらのひとしずく 🌿', 214, 72);
    ctx.font = '11px system-ui'; ctx.fillStyle = '#b5dda6'; ctx.fillText('ハンドルで落下位置を調整！', 213, 91);
    for (const peg of pegs) {
      ctx.fillStyle = '#766432'; ctx.beginPath(); ctx.arc(peg.x + 1.3, peg.y + 2, 5.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f9eab9'; ctx.beginPath(); ctx.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save();
    ctx.shadowColor = '#fce39a'; ctx.shadowBlur = 16;
    ctx.fillStyle = '#9d6d2b'; ctx.beginPath(); ctx.ellipse(220, 277, 100, 77, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#f7dc86'; ctx.beginPath(); ctx.ellipse(220, 277, 96, 73, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#153f38'; ctx.beginPath(); ctx.ellipse(220, 277, 90, 67, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,236,141,.58)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(220, 277, 98, 75, 0, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 14; i++) {
      const angle = i * Math.PI * 2 / 14;
      const x = 220 + Math.cos(angle) * 94, y = 277 + Math.sin(angle) * 71;
      ctx.fillStyle = '#fff5b5'; ctx.beginPath(); ctx.arc(x, y, 2.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save();
    ctx.lineCap = 'round';
    for (const rail of guideRails) {
      ctx.strokeStyle = '#314139'; ctx.lineWidth = 14;
      ctx.beginPath(); ctx.moveTo(rail.x1 + 2, rail.y1 + 3); ctx.lineTo(rail.x2 + 2, rail.y2 + 3); ctx.stroke();
      ctx.strokeStyle = '#d1a34d'; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(rail.x1, rail.y1); ctx.lineTo(rail.x2, rail.y2); ctx.stroke();
      ctx.strokeStyle = '#fff0ba'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(rail.x1 - 1, rail.y1 - 1); ctx.lineTo(rail.x2 - 1, rail.y2 - 1); ctx.stroke();
      for (const point of [{x: rail.x1, y: rail.y1}, {x: rail.x2, y: rail.y2}]) {
        ctx.fillStyle = '#f9e5a4'; ctx.beginPath(); ctx.arc(point.x, point.y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#6d5b34'; ctx.beginPath(); ctx.arc(point.x, point.y, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
    for (const pocket of pockets) {
      ctx.fillStyle = pocket.type === 'start' ? '#fbe181' : '#bce9a9';
      ctx.beginPath(); ctx.arc(pocket.x, pocket.y, pocket.r + 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#073726'; ctx.beginPath(); ctx.arc(pocket.x, pocket.y, pocket.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = pocket.type === 'start' ? '#fff0a2' : '#e6ffd6';
      ctx.font = pocket.type === 'start' ? '900 11px system-ui' : '900 11px system-ui';
      ctx.fillText(pocket.type === 'start' ? 'START' : `+${pocketPayout}`, pocket.x, pocket.y + 4);
    }
    ctx.fillStyle = '#ffe4a5'; ctx.font = 'bold 11px system-ui'; ctx.fillText('OUT', 220, 553);
  }
  function spriteFor(face) {
    let sprite = ballSprites.get(face);
    if (sprite) return sprite;
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = 32;
    const paint = sprite.getContext('2d');
    paint.fillStyle = 'rgba(0,0,0,.35)';
    paint.beginPath(); paint.arc(18, 19, 11.5, 0, Math.PI * 2); paint.fill();
    paint.fillStyle = '#fff9e7';
    paint.beginPath(); paint.arc(16, 16, 10.5, 0, Math.PI * 2); paint.fill();
    paint.textAlign = 'center'; paint.textBaseline = 'middle';
    paint.font = '19px "Segoe UI Emoji","Apple Color Emoji",sans-serif';
    paint.fillText(face, 16, 17);
    ballSprites.set(face, sprite);
    return sprite;
  }
  function drawBoard() {
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const ball of balls) {
      ctx.drawImage(spriteFor(ball.face), ball.x - 16, ball.y - 16);
    }
    ctx.textBaseline = 'alphabetic';
  }
  function frame(time) {
    if (panel.hidden || $('pachiGame').hidden) { frameId = 0; lastFrame = 0; return; }
    if (!lastFrame) lastFrame = time - frameInterval;
    if (time - lastFrame < frameInterval * .9) {
      frameId = requestAnimationFrame(frame);
      return;
    }
    const elapsed = Math.min((time - lastFrame) / 1000, .05);
    lastFrame = time;
    const substeps = Math.max(1, Math.ceil(elapsed / (1 / 60)));
    const hadBalls = balls.length > 0;
    for (let i = 0; i < substeps; i++) step(elapsed / substeps);
    if (balls.length || hadBalls) drawBoard();
    if (!balls.length) { frameId = 0; lastFrame = 0; return; }
    frameId = requestAnimationFrame(frame);
  }
  function startLoop() { if (!frameId && !panel.hidden && !$('pachiGame').hidden) frameId = requestAnimationFrame(frame); }
  function setOpen(open) {
    panel.hidden = !open;
    shell.classList.toggle('is-collapsed', !open);
    $('pachiToggle').setAttribute('aria-expanded', String(open));
    $('pachiToggle').setAttribute('aria-label', open ? '草パチを閉じる' : '草パチを開く');
    if (open) { unlockAudio(); startLoop(); if (player?.pendingJackpot > 0) startPayout(); }
    else { closeShare(); stopFiring(); pausePayout(); stopSounds(); }
  }
  function drawShareCard() {
    if (!player) return;
    const canvas = $('pachiShareCanvas');
    const c = canvas.getContext('2d');
    const gradient = c.createLinearGradient(0, 0, 1080, 1080);
    gradient.addColorStop(0, '#092c25'); gradient.addColorStop(.55, '#226d45'); gradient.addColorStop(1, '#b4a84c');
    c.fillStyle = gradient; c.fillRect(0, 0, 1080, 1080);
    c.strokeStyle = 'rgba(232,255,189,.18)'; c.lineWidth = 4;
    for (let i = 0; i < 12; i++) {
      c.beginPath(); c.arc(90 + (i * 83) % 960, 80 + (i * 167) % 960, 45 + i * 7, 0, Math.PI * 2); c.stroke();
    }
    c.fillStyle = '#e8ffb5'; c.font = 'bold 52px sans-serif'; c.textAlign = 'center';
    c.fillText('🌿 KUSA PACHI', 540, 125);
    c.fillStyle = 'rgba(5,35,29,.78)';
    c.beginPath();
    if (c.roundRect) c.roundRect(80, 175, 920, 780, 40);
    else c.rect(80, 175, 920, 780);
    c.fill();
    c.fillStyle = '#f2e0a5'; c.font = 'bold 42px sans-serif';
    c.fillText($('pachiShareName').checked ? player.name : '草パチプレイヤー', 540, 270, 820);
    c.fillStyle = '#bbdfc6'; c.font = 'bold 42px sans-serif'; c.fillText('持ち球', 540, 365);
    c.fillStyle = '#ffffff'; c.font = 'bold 102px sans-serif'; c.fillText(player.balls.toLocaleString('ja-JP'), 540, 480, 800);
    c.fillStyle = '#bbdfc6'; c.font = 'bold 42px sans-serif'; c.fillText('所持草', 540, 600);
    c.fillStyle = '#fff0a4'; c.font = 'bold 102px sans-serif'; c.fillText(player.grass.toLocaleString('ja-JP'), 540, 715, 800);
    c.fillStyle = '#f0ffd9'; c.font = 'bold 42px sans-serif'; c.fillText(`${player.wager}草パチで遊技中`, 540, 845);
    c.fillStyle = '#e2f4cb'; c.font = '28px sans-serif'; c.fillText('草むら遊技場', 540, 1020);
    $('pachiShareSummary').textContent = `持ち球 ${player.balls.toLocaleString('ja-JP')}球・所持草 ${player.grass.toLocaleString('ja-JP')}草・${player.wager}草パチ`;
  }
  function closeShare() {
    if ($('pachiShareModal').hidden) return;
    $('pachiShareModal').hidden = true;
    if (!$('pachiGame').hidden && !panel.hidden) $('pachiShareOpen').focus();
  }
  function shareText() {
    return `${$('pachiShareName').checked ? `${player.name}の` : ''}草パチ記録：持ち球${player.balls.toLocaleString('ja-JP')}球、所持草${player.grass.toLocaleString('ja-JP')}草。${player.wager}草パチで遊技中！`;
  }
  function exportBackup() {
    try {
      const backup = {
        format: 'kusa-play-backup', version: 2, savedAt: new Date().toISOString(),
        profiles,
        rewards: rewards.read(),
        gacha: JSON.parse(localStorage.getItem(rewards.gachaKey) || '{}')
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `kusa-play-${today()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      $('pachiExchangeMessage').textContent = '記録のバックアップを保存しました。ファイルを大切に保管してください。';
    } catch {
      $('pachiExchangeMessage').textContent = 'バックアップを作れませんでした。ブラウザの保存設定を確認してください。';
    }
  }
  async function importBackup(file) {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('too large');
      const backup = JSON.parse(await file.text());
      if (backup.format !== 'kusa-play-backup' || ![1, 2].includes(backup.version) || !Array.isArray(backup.profiles) ||
          !backup.rewards || !backup.gacha || typeof backup.gacha !== 'object') throw new Error('invalid backup');
      const restoredProfiles = backup.profiles.filter(p => p && typeof p.name === 'string' && p.name.trim() && p.name.length <= 20)
        .slice(0, 1000).map(p => ({
          name: p.name, balls: validCount(p.balls, 250), grass: validCount(p.grass), wager: validWager(p.wager), spins: validCount(p.spins),
          hits: validCount(p.hits), streak: validCount(p.streak), bestStreak: validCount(p.bestStreak),
          rushLeft: Math.min(validCount(p.rushLeft), rushSpins), lastBonusDay: typeof p.lastBonusDay === 'string' ? p.lastBonusDay : '',
          inFlight: validCount(p.inFlight), inFlightValue: validCount(p.inFlightValue, validCount(p.inFlight)),
          pendingJackpot: validCount(p.pendingJackpot), jackpotRate: validWager(p.jackpotRate),
          jackpotTotal: validCount(p.jackpotTotal, Math.ceil(validCount(p.pendingJackpot) / jackpotAmounts[validWager(p.jackpotRate)]) * jackpotAmounts[validWager(p.jackpotRate)])
        }));
      const gacha = {
        lastDrawAt: Number.isFinite(backup.gacha.lastDrawAt) && backup.gacha.lastDrawAt >= 0 ? backup.gacha.lastDrawAt : 0,
        obtainedCards: Array.isArray(backup.gacha.obtainedCards)
          ? backup.gacha.obtainedCards.filter(id => typeof id === 'string' && id.length <= 100).slice(0, 10000) : [],
        grassPoint: validCount(backup.gacha.grassPoint)
      };
      if (!window.confirm('現在の持ち球・草・ガチャ券・図鑑の記録を、読み込むファイルの内容で置き換えます。続けますか？')) return;
      stopFiring();
      const entries = [
        [profileKey, JSON.stringify(restoredProfiles)],
        [rewards.key, JSON.stringify(rewards.normalize(backup.rewards))],
        [rewards.gachaKey, JSON.stringify(gacha)]
      ];
      const previous = entries.map(([key]) => [key, localStorage.getItem(key)]);
      try {
        for (const [key, value] of entries) localStorage.setItem(key, value);
      } catch (error) {
        for (const [key, value] of previous) {
          try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
          catch { /* 保存領域が使えない場合 */ }
        }
        throw error;
      }
      window.location.reload();
    } catch {
      $('pachiExchangeMessage').textContent = '記録を読み込めませんでした。草パチで保存したJSONファイルを選んでください。';
    } finally {
      $('pachiRestoreFile').value = '';
    }
  }
  $('pachiToggle').addEventListener('click', () => setOpen(panel.hidden));
  $('pachiClose').addEventListener('click', () => setOpen(false));
  $('pachiStart').addEventListener('click', startPlayer);
  $('pachiName').addEventListener('keydown', event => { if (event.key === 'Enter') startPlayer(); });
  $('pachiSwitch').addEventListener('click', switchPlayer);
  $('pachiShareOpen').addEventListener('click', () => {
    if (!player) return;
    drawShareCard();
    $('pachiShareMessage').textContent = '';
    $('pachiShareModal').hidden = false;
    $('pachiShareClose').focus();
  });
  $('pachiShareClose').addEventListener('click', closeShare);
  $('pachiShareModal').addEventListener('click', event => { if (event.target === $('pachiShareModal')) closeShare(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('pachiShareModal').hidden) closeShare(); });
  $('pachiShareName').addEventListener('change', drawShareCard);
  $('pachiShareDownload').addEventListener('click', () => {
    if (!player) return;
    const link = document.createElement('a');
    link.href = $('pachiShareCanvas').toDataURL('image/png');
    link.download = `kusa-pachi-${today()}.png`;
    document.body.appendChild(link); link.click(); link.remove();
    $('pachiShareMessage').textContent = 'シェア画像を保存しました。';
  });
  $('pachiShareNative').addEventListener('click', async () => {
    if (!player) return;
    if (!navigator.share) { $('pachiShareMessage').textContent = 'このブラウザでは直接共有できません。画像を保存して投稿してください。'; return; }
    try {
      const blob = await new Promise(resolve => $('pachiShareCanvas').toBlob(resolve, 'image/png'));
      const file = blob ? new File([blob], `kusa-pachi-${today()}.png`, {type: 'image/png'}) : null;
      const data = {title: '草パチの記録', text: shareText()};
      if (file && navigator.canShare?.({files: [file]})) data.files = [file];
      await navigator.share(data);
      $('pachiShareMessage').textContent = data.files ? '画像を共有しました。' : '記録のテキストを共有しました。画像は「画像を保存」から利用できます。';
    } catch (error) {
      if (error?.name !== 'AbortError') $('pachiShareMessage').textContent = '共有できませんでした。画像を保存して投稿してください。';
    }
  });
  $('pachiRename').addEventListener('click', () => {
    if (!player) return;
    const input = window.prompt('新しいプレイヤーネーム（20文字以内）', player.name);
    if (input === null) return;
    const name = input.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 20) { announce('名前は1～20文字で入力してください。', 2500); return; }
    if (name === player.name) return;
    if (profiles.some(profile => profile !== player && profile.name === name)) { announce('その名前はすでに使われています。', 2500); return; }
    const previous = player.name;
    player.name = name;
    if (!saveProfiles()) { player.name = previous; announce('名前を保存できませんでした。', 2500); return; }
    $('pachiName').value = name;
    updateUI();
    announce(`プレイヤーネームを「${name}」に変更しました。`, 2500);
  });
  $('pachiWager').addEventListener('change', event => {
    if (!player || event.target.name !== 'pachiWager') return;
    const next = validWager(event.target.value);
    if (balls.length || player.pendingJackpot || payoutFinishTimer) { updateUI(); return; }
    stopFiring();
    const previous = player.wager;
    player.wager = next;
    if (!saveProfiles()) { player.wager = previous; announce('掛け金を保存できませんでした。', 2500); }
    else announce(`${player.wager}草パチに切り替えました。`, 1600);
    updateUI();
  });
  $('pachiGrassAmount').addEventListener('input', () => updateExchangeUI());
  $('pachiBallAmount').addEventListener('input', () => updateExchangeUI());
  document.querySelectorAll('[data-pachi-amount]').forEach(button => button.addEventListener('click', () => {
    if (!player) return;
    const choice = button.dataset.pachiAmount;
    $('pachiGrassAmount').value = choice === 'all' ? player.balls : choice === 'half' ? Math.floor(player.balls / 2) : Math.min(Number(choice), player.balls);
    updateExchangeUI();
  }));
  document.querySelectorAll('[data-pachi-return]').forEach(button => button.addEventListener('click', () => {
    if (!player) return;
    const choice = button.dataset.pachiReturn;
    $('pachiBallAmount').value = choice === 'all' ? player.grass : choice === 'half' ? Math.floor(player.grass / 2) : Math.min(Number(choice), player.grass);
    updateExchangeUI();
  }));
  $('pachiConvertButton').addEventListener('click', () => {
    if (!player) return;
    const amount = Number($('pachiGrassAmount').value);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > player.balls || player.grass + amount > 100000000) { updateExchangeUI(); return; }
    const previousBalls = player.balls, previousGrass = player.grass;
    player.balls -= amount;
    player.grass += amount;
    if (!saveProfiles()) {
      player.balls = previousBalls; player.grass = previousGrass;
      $('pachiExchangeMessage').textContent = '交換を保存できませんでした。持ち球は減っていません。';
    } else {
      $('pachiExchangeMessage').textContent = `${amount.toLocaleString('ja-JP')}球を${amount.toLocaleString('ja-JP')}草に交換しました。`;
      $('pachiGrassAmount').value = '';
      playChime();
    }
    updateUI();
  });
  $('pachiReturnButton').addEventListener('click', () => {
    if (!player) return;
    const amount = Number($('pachiBallAmount').value);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > player.grass || player.balls + amount > 100000000) { updateExchangeUI(); return; }
    const previousBalls = player.balls, previousGrass = player.grass;
    player.grass -= amount;
    player.balls += amount;
    if (!saveProfiles()) {
      player.balls = previousBalls; player.grass = previousGrass;
      $('pachiExchangeMessage').textContent = '交換を保存できませんでした。草は減っていません。';
    } else {
      $('pachiExchangeMessage').textContent = `${amount.toLocaleString('ja-JP')}草を${amount.toLocaleString('ja-JP')}球に交換しました。`;
      $('pachiBallAmount').value = '';
      playChime();
    }
    updateUI();
  });
  $('pachiExchangeButton').addEventListener('click', () => {
    if (!player) return;
    if (player.grass < rewards.exchangeCost) {
      $('pachiExchangeMessage').textContent = '交換には15,000草必要です。';
      updateExchangeUI();
      return;
    }
    const previousGrass = player.grass;
    player.grass -= rewards.exchangeCost;
    if (!saveProfiles()) {
      player.grass = previousGrass;
      updateUI();
      $('pachiExchangeMessage').textContent = '草を保存できず、交換を中止しました。ブラウザの保存設定を確認してください。';
      return;
    }
    const result = rewards.addTicket();
    if (!result.ok) {
      player.grass = previousGrass;
      const restored = saveProfiles();
      updateUI();
      $('pachiExchangeMessage').textContent = restored
        ? 'ガチャ券を保存できず、草を戻しました。ブラウザの保存設定を確認してください。'
        : '交換を保存できませんでした。記録の復元が必要なため、ページを閉じずにバックアップしてください。';
      return;
    }
    updateUI();
    $('pachiExchangeMessage').textContent = '15,000草をガチャ券1枚に交換しました。草ガチャで使えます！';
    playChime();
  });
  $('pachiBackupButton').addEventListener('click', exportBackup);
  $('pachiRestoreFile').addEventListener('change', event => importBackup(event.target.files[0]));
  $('pachiFire').addEventListener('pointerdown', event => { event.preventDefault(); $('pachiFire').setPointerCapture(event.pointerId); startFiring(); });
  $('pachiFire').addEventListener('pointerup', stopFiring);
  $('pachiFire').addEventListener('pointercancel', stopFiring);
  $('pachiFire').addEventListener('lostpointercapture', stopFiring);
  $('pachiFire').addEventListener('keydown', event => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); startFiring(); } });
  $('pachiFire').addEventListener('keyup', event => { if (event.key === ' ' || event.key === 'Enter') stopFiring(); });
  $('pachiPower').addEventListener('input', () => { $('pachiPowerValue').textContent = `${$('pachiPower').value}%`; });
  $('pachiSound').addEventListener('click', () => {
    soundOn = !soundOn;
    $('pachiSound').textContent = soundOn ? '🔊 効果音 ON' : '🔇 効果音 OFF';
    $('pachiSound').setAttribute('aria-pressed', String(soundOn));
    try { localStorage.setItem(soundKey, soundOn ? 'on' : 'off'); } catch { /* 保存不可でも切替は有効 */ }
    if (soundOn) { unlockAudio(); playSound('start', .18); playTick(740, .018); }
    else {
      stopSounds();
      if (soundContext?.state === 'running') {
        soundContext.suspend().then(() => { if (soundOn) unlockAudio(); }).catch(() => {});
      }
    }
  });
  $('pachiDaily').addEventListener('click', () => {
    if (!player || player.lastBonusDay === today()) return;
    unlockAudio();
    player.lastBonusDay = today(); player.balls += 50;
    saveProfiles(); updateUI(); announce('🎁 今日の補充！ 50球追加しました。', 2400); playChime();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopFiring(); pausePayout(); stopSounds(); }
    else { startLoop(); if (player?.pendingJackpot > 0) startPayout(); }
  });
  window.addEventListener('pagehide', () => { stopFiring(); pausePayout(); stopSounds(); if (player) saveProfiles(); });
  window.addEventListener('kusa-rewards-changed', () => updateExchangeUI());
  window.addEventListener('storage', event => { if (event.key === rewards.key) updateExchangeUI(); });
  initAudio(); renderProfiles(); drawBoardScenery();
  faces.forEach(spriteFor);
  drawBoard();
  $('pachiSound').textContent = soundOn ? '🔊 効果音 ON' : '🔇 効果音 OFF';
  $('pachiSound').setAttribute('aria-pressed', String(soundOn));
})();
