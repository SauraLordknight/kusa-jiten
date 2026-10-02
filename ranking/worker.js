// Leaderboard API. Bind the D1 database as DB in the Worker dashboard.
const DAY = 86_400_000;
const JST = 9 * 60 * 60 * 1000;
const CACHE_SECONDS = 60;
const MAX_BODY = 2048;
const ID_PATTERN = /^[a-f0-9]{32}$/;
const ALLOWED_ORIGINS = new Set([
  'https://sauralordknight.github.io',
  'http://127.0.0.1:8765',
  'http://localhost:8765',
  'null', // file:// preview of the local test page
]);
const LOCAL_TEST_ORIGIN = {test(origin) {
  try {
    const url = new URL(origin);
    const octets = url.hostname.split('.').map(Number);
    return url.protocol === 'http:' && url.port === '8765' &&
      (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168));
  } catch { return false; }
}};

function cors(request) {
  const origin = request.headers.get('Origin');
  return origin && (ALLOWED_ORIGINS.has(origin) || LOCAL_TEST_ORIGIN.test(origin)) ? origin : null;
}

function reply(request, body, status = 200) {
  const origin = cors(request);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers.Vary = 'Origin';
  }
  return new Response(JSON.stringify(body), {status, headers});
}

async function readBody(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BODY) throw new Error('too_large');
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new Error('too_large');
  try { return JSON.parse(raw); } catch { throw new Error('bad_json'); }
}

function validId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

function validName(value) {
  return typeof value === 'string' && value.trim().length >= 1 &&
    Array.from(value.trim()).length <= 20 && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validWager(value) { return [1, 5, 10].includes(value); }

function siteOf(request) {
  return cors(request) === 'https://sauralordknight.github.io' ? 'public' : 'test';
}

function storedId(request, id) {
  return siteOf(request) === 'public' ? `p:${id}` : id;
}

function jstDay(timestamp) {
  return new Date(timestamp + JST).toISOString().slice(0, 10);
}

function jstDayStart(timestamp) {
  const shifted = new Date(timestamp + JST);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - JST;
}

async function recordDailyVisitor(request, env, visitorId, now) {
  const day = jstDay(now);
  const id = storedId(request, visitorId);
  await env.DB.prepare(`
    INSERT INTO daily_visitors (day, visitor_id, first_seen) VALUES (?, ?, ?)
    ON CONFLICT(day, visitor_id) DO NOTHING
  `).bind(day, id, now).run();
}

async function rateLimit(request, env, bucket) {
  if (!env.RANK_RATE_LIMIT) return {error: 'rate_limit_unavailable', status: 503};
  const source = request.headers.get('CF-Connecting-IP') || 'unknown';
  const result = await env.RANK_RATE_LIMIT.limit({key: `${bucket}:${source}`});
  return result.success ? null : {error: 'rate_limited', status: 429};
}

async function snapshot(request, env, ctx, wager) {
  const site = siteOf(request);
  const scope = site === 'public' ? 'LIKE' : 'NOT LIKE';
  const now = Date.now();
  const day = jstDay(now);
  const dayStart = jstDayStart(now);
  const dayEnd = dayStart + DAY;
  const cache = caches.default;
  const key = new Request(new URL(`/cache/v4/${site}/${day}/${wager}`, request.url));
  let value = await cache.match(key).then(response => response?.json());
  if (!value) {
    const result = await env.DB.prepare(`
      SELECT e.player_id,
        (SELECT n.display_name FROM score_events n WHERE n.player_id = e.player_id
         ORDER BY n.created_at DESC, n.event_id DESC LIMIT 1) AS name,
        SUM(e.net_balls) AS balls
      FROM score_events e
      WHERE e.wager = ? AND e.created_at >= ? AND e.created_at < ? AND e.player_id ${scope} ?
      GROUP BY e.player_id
      ORDER BY balls DESC, player_id ASC
      LIMIT 10000
    `).bind(wager, dayStart, dayEnd, 'p:%').all();
    const rows = result.results.map((item, index) => ({
      rank: index + 1,
      playerId: item.player_id,
      name: item.name,
      balls: item.balls,
    }));
    value = {rows, participants: rows.length, day, updatedAt: now};
    ctx.waitUntil(cache.put(key, new Response(JSON.stringify(value), {
      headers: {'Cache-Control': `public, max-age=${CACHE_SECONDS}`},
    })));
  }

  const dailyVisitors = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM daily_visitors WHERE day = ? AND visitor_id ${scope} ?`
  ).bind(jstDay(now), 'p:%').first();
  return {...value, visitorsToday: dailyVisitors?.count || 0};
}

async function overview(request, env, ctx) {
  const body = await readBody(request);
  if (!validWager(body?.wager) || (body?.visitorId != null && !validId(body.visitorId)) ||
      (body.playerId != null && !validId(body.playerId))) {
    return reply(request, {error: 'invalid_request'}, 400);
  }
  const value = await snapshot(request, env, ctx, body.wager);
  const mine = value.rows.find(row => row.playerId === storedId(request, body.playerId)) || null;
  return reply(request, {
    wager: body.wager,
    leaders: value.rows.slice(0, 10).map(({rank, name, balls}) => ({rank, name, balls})),
    mine: mine ? {rank: mine.rank, name: mine.name, balls: mine.balls} : null,
    participants: value.participants,
    visitorsToday: value.visitorsToday,
    updatedAt: value.updatedAt,
    truncated: value.rows.length === 10000,
  });
}

async function heartbeat(request, env) {
  const body = await readBody(request);
  if (!validId(body?.visitorId)) return reply(request, {error: 'invalid_request'}, 400);
  await recordDailyVisitor(request, env, body.visitorId, Date.now());
  return reply(request, {ok: true});
}

async function submit(request, env) {
  const body = await readBody(request);
  if (!validId(body?.eventId) || !validId(body?.playerId) || !validName(body?.name) ||
      !validWager(body?.wager) || !Number.isSafeInteger(body?.shots) ||
      body.shots < 0 || body.shots > 10000 || !Number.isSafeInteger(body?.credit) ||
      body.credit < 0 || body.credit > 100000000 ||
      (body.shots === 0 && body.credit === 0)) {
    return reply(request, {error: 'invalid_record'}, 400);
  }
  const now = Date.now();
  const eventId = storedId(request, body.eventId);
  const playerId = storedId(request, body.playerId);
  const duplicate = await env.DB.prepare(
    'SELECT event_id FROM score_events WHERE event_id = ?'
  ).bind(eventId).first();
  if (duplicate) return reply(request, {ok: true, saved: false});
  const recent = await env.DB.prepare(`
    SELECT COUNT(*) AS count FROM score_events
    WHERE player_id = ? AND created_at >= ?
  `).bind(playerId, now - 3600000).first();
  if (recent.count >= 24) return reply(request, {error: 'rate_limited'}, 429);

  const net = body.credit - body.shots * body.wager;
  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO score_events
      (event_id, player_id, display_name, wager, shots, credit, net_balls, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(eventId, playerId, body.name.trim(), body.wager,
    body.shots, body.credit, net, now).run();
  if (result.meta.rows_written > 0) {
    try {
      const day = jstDay(now);
      await caches.default.delete(new Request(new URL(`/cache/v4/${siteOf(request)}/${day}/${body.wager}`, request.url)));
    }
    catch { /* 記録の保存をキャッシュ削除の失敗に巻き込まない */ }
  }
  return reply(request, {ok: true, saved: result.meta.rows_written > 0});
}

export default {
  async scheduled(_event, env, ctx) {
    const cutoff = Date.now() - 2 * DAY;
    const dailyCutoff = jstDay(Date.now() - 2 * DAY);
    ctx.waitUntil(Promise.all([
      env.DB.prepare('DELETE FROM score_events WHERE created_at < ?').bind(cutoff).run(),
      env.DB.prepare('DELETE FROM visitors WHERE last_seen < ?').bind(cutoff).run(),
      env.DB.prepare('DELETE FROM daily_visitors WHERE day < ?').bind(dailyCutoff).run(),
    ]));
  },
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') {
      return reply(request, {ok: true, service: 'kusa-pachi-ranking-test'});
    }
    if (!env.DB) return reply(request, {error: 'database_unavailable'}, 503);
    if (request.method === 'OPTIONS') {
      if (!cors(request)) return reply(request, {error: 'forbidden'}, 403);
      const headers = {
        'Access-Control-Allow-Origin': cors(request),
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      };
      return new Response(null, {status: 204, headers});
    }
    if (request.method !== 'POST' || !cors(request)) return reply(request, {error: 'not_found'}, 404);
    try {
      if (path === '/v1/overview') {
        const limited = await rateLimit(request, env, 'overview');
        if (limited) return reply(request, {error: limited.error}, limited.status);
        return await overview(request, env, ctx);
      }
      if (path === '/v1/heartbeat') {
        const limited = await rateLimit(request, env, 'heartbeat');
        if (limited) return reply(request, {error: limited.error}, limited.status);
        return await heartbeat(request, env);
      }
      if (path === '/v1/score') {
        const limited = await rateLimit(request, env, 'score');
        if (limited) return reply(request, {error: limited.error}, limited.status);
        return await submit(request, env);
      }
      return reply(request, {error: 'not_found'}, 404);
    } catch (error) {
      if (error.message === 'too_large') return reply(request, {error: 'too_large'}, 413);
      if (error.message === 'bad_json') return reply(request, {error: 'bad_json'}, 400);
      console.error('ranking request failed', error);
      return reply(request, {error: 'temporarily_unavailable'}, 503);
    }
  },
};
