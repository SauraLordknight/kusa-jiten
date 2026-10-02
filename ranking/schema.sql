CREATE TABLE IF NOT EXISTS score_events (
  event_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  wager INTEGER NOT NULL CHECK (wager IN (1, 5, 10)),
  shots INTEGER NOT NULL CHECK (shots >= 0),
  credit INTEGER NOT NULL CHECK (credit >= 0),
  net_balls INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS score_events_wager_time
  ON score_events (wager, created_at);

CREATE INDEX IF NOT EXISTS score_events_player_time
  ON score_events (player_id, created_at);

CREATE INDEX IF NOT EXISTS score_events_created_at
  ON score_events (created_at);

CREATE TABLE IF NOT EXISTS visitors (
  visitor_id TEXT PRIMARY KEY,
  last_seen INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS visitors_last_seen
  ON visitors (last_seen);

CREATE TABLE IF NOT EXISTS daily_visitors (
  day TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  PRIMARY KEY (day, visitor_id)
);
