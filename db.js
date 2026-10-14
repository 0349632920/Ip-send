const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.RENDER
  ? '/data/visits.db'
  : path.join(__dirname, 'visits.db');

let db;
try {
  db = new Database(DB_PATH);
} catch (e) {
  db = new Database(path.join(__dirname, 'visits.db'));
}

db.exec(`
  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT,
    time TEXT,
    user_agent TEXT,
    platform TEXT,
    language TEXT,
    screen TEXT,
    cpu_cores INTEGER,
    device_memory REAL,
    gpu_vendor TEXT,
    gpu_renderer TEXT,
    battery TEXT,
    timezone TEXT,
    connection TEXT,
    fonts TEXT,
    local_ips TEXT,
    fingerprint TEXT,
    referrer TEXT,
    country TEXT,
    region TEXT,
    city TEXT,
    isp TEXT,
    lat REAL,
    lon REAL,
    time_on_page TEXT,
    clicks INTEGER,
    scroll_max TEXT,
    raw_json TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_fingerprint ON visits(fingerprint);
  CREATE INDEX IF NOT EXISTS idx_ip ON visits(ip);
  CREATE INDEX IF NOT EXISTS idx_time ON visits(created_at);
`);

module.exports = db;
