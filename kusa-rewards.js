(() => {
  'use strict';

  const key = 'kusaPachiRewardsV1';
  const gachaKey = 'kusa-jiten-gacha-v1';
  const exchangeCost = 15000;
  let memory = {tickets: 0};

  const validCount = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

  function normalize(value) {
    return {tickets: validCount(value?.tickets)};
  }

  function read() {
    try {
      const stored = localStorage.getItem(key);
      if (stored) memory = normalize(JSON.parse(stored));
    } catch { /* 保存できない場合も、このページを開いている間は遊べる */ }
    return normalize(memory);
  }

  function save(state) {
    memory = normalize(state);
    try {
      localStorage.setItem(key, JSON.stringify(memory));
      return true;
    } catch { return false; }
  }

  function notify() {
    window.dispatchEvent(new Event('kusa-rewards-changed'));
  }

  function addTicket() {
    const state = read();
    const previous = normalize(state);
    if (state.tickets >= Number.MAX_SAFE_INTEGER) return {ok: false, state};
    state.tickets++;
    if (!save(state)) { memory = previous; return {ok: false, state: previous, saveFailed: true}; }
    notify();
    return {ok: true, state};
  }

  function spendTicket() {
    const state = read();
    if (state.tickets < 1) return false;
    const previous = normalize(state);
    state.tickets--;
    if (!save(state)) { memory = previous; return false; }
    notify();
    return true;
  }

  window.KusaRewards = Object.freeze({key, gachaKey, exchangeCost, read, save, addTicket, spendTicket, notify, normalize});
})();
