const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'light-todo.db');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const SESSION_DAYS = 30;

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 4000;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lists (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    list_id TEXT,
    title TEXT NOT NULL,
    task_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    sort_order INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    completed_on TEXT,
    source_list_id TEXT,
    source_list_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_lists_user ON lists(user_id, position);
  CREATE INDEX IF NOT EXISTS idx_tasks_user_status_date ON tasks(user_id, status, task_date);
  CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id);
`);

const COLORS = ['#9DBFB2', '#AEBFCE', '#C5B7D6', '#C5AEB6', '#BBC3A6', '#B7B0D5'];

function nowIso() {
  return new Date().toISOString();
}

function dateInTimeZone(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function today() {
  return dateInTimeZone();
}

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function json(res, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(payload);
}

function fail(res, status, code, message) {
  json(res, status, { error: { code, message } });
}

function parseCookies(req) {
  const cookies = {};
  for (const item of (req.headers.cookie || '').split(';')) {
    const index = item.indexOf('=');
    if (index < 0) continue;
    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const [method, saltText, hashText] = String(stored).split('$');
    if (method !== 'scrypt') return false;
    const expected = Buffer.from(hashText, 'base64');
    const actual = crypto.scryptSync(password, Buffer.from(saltText, 'base64'), expected.length, {
      N: 16384,
      r: 8,
      p: 1
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash(token), userId, expires);
  return token;
}

function sessionCookie(token, maxAge = SESSION_DAYS * 86400) {
  return `session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function currentUser(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.username, u.created_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash(token), nowIso()) || null;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('请求内容过大。'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('请求格式无效。'));
      }
    });
    req.on('error', reject);
  });
}

function ownedList(userId, listId) {
  return db.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?').get(listId, userId);
}

function ownedTask(userId, taskId) {
  return db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
}

function nextListPosition(userId) {
  const row = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS value FROM lists WHERE user_id = ?')
    .get(userId);
  return Number(row.value);
}

function nextTaskOrder(userId, taskDate) {
  const row = db.prepare(`
    SELECT COALESCE(MAX(sort_order), -1) + 1 AS value
    FROM tasks
    WHERE user_id = ? AND task_date = ? AND status = 'open'
  `).get(userId, taskDate);
  return Number(row.value);
}

function createDefaultList(userId) {
  const listId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO lists (id, user_id, name, color, position, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(listId, userId, '我的待办', COLORS[0], 0, nowIso());
  return listId;
}

function publicState(userId) {
  const lists = db.prepare(`
    SELECT l.id, l.name, l.color, l.position,
      (SELECT COUNT(*) FROM tasks t WHERE t.list_id = l.id AND t.status = 'open') AS open_count
    FROM lists l
    WHERE l.user_id = ?
    ORDER BY l.position ASC, l.created_at ASC
  `).all(userId);

  const openTasks = db.prepare(`
    SELECT
      t.id, t.title, t.task_date AS date, t.status, t.sort_order,
      t.created_at, t.updated_at,
      l.id AS list_id,
      COALESCE(l.name, t.source_list_name, '已删除分表') AS list_name,
      COALESCE(l.color, '#C8C4BB') AS list_color,
      t.source_list_id
    FROM tasks t
    LEFT JOIN lists l ON l.id = t.list_id
    WHERE t.user_id = ? AND t.status = 'open'
    ORDER BY t.task_date ASC, t.sort_order ASC, t.created_at ASC
  `).all(userId).map((task) => ({ ...task, sort_order: Number(task.sort_order) }));

  const completedTasks = db.prepare(`
    SELECT
      t.id, t.title, t.task_date AS date, t.status,
      t.completed_at, t.completed_on, t.created_at, t.updated_at,
      t.source_list_id,
      COALESCE(sl.name, t.source_list_name, '已删除分表') AS source_list_name,
      COALESCE(sl.color, '#C8C4BB') AS source_list_color,
      CASE WHEN sl.id IS NULL THEN 0 ELSE 1 END AS can_restore
    FROM tasks t
    LEFT JOIN lists sl ON sl.id = t.source_list_id AND sl.user_id = t.user_id
    WHERE t.user_id = ? AND t.status = 'completed'
    ORDER BY t.completed_at DESC, t.created_at DESC
  `).all(userId);

  return { today: today(), lists, openTasks, completedTasks };
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  if (pathname === '/api/health' && method === 'GET') {
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/auth/register' && method === 'POST') {
    const body = await readJson(req);
    const username = cleanText(body.username, 24);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!/^[\p{L}\p{N}_-]{2,24}$/u.test(username)) {
      return fail(res, 400, 'INVALID_USERNAME', '用户名需要 2–24 个字符，可使用中文、字母、数字、下划线或短横线。');
    }
    if (password.length < 6 || password.length > 128) {
      return fail(res, 400, 'INVALID_PASSWORD', '密码需要 6–128 个字符。');
    }
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
      return fail(res, 409, 'USERNAME_TAKEN', '这个用户名已经有人使用。');
    }

    const userId = crypto.randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .run(userId, username, hashPassword(password), nowIso());
      createDefaultList(userId);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    const token = createSession(userId);
    return json(res, 201, {
      user: { id: userId, username },
      state: publicState(userId)
    }, { 'Set-Cookie': sessionCookie(token) });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readJson(req);
    const username = cleanText(body.username, 24);
    const password = typeof body.password === 'string' ? body.password : '';
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return fail(res, 401, 'ACCOUNT_NOT_FOUND', '不存在该账号，请先创建账号。');
    }
    if (!verifyPassword(password, user.password_hash)) {
      return fail(res, 401, 'INVALID_PASSWORD', '密码不正确。');
    }
    const token = createSession(user.id);
    return json(res, 200, {
      user: { id: user.id, username: user.username },
      state: publicState(user.id)
    }, { 'Set-Cookie': sessionCookie(token) });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const token = parseCookies(req).session;
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', '请先登录。');

  if (pathname === '/api/auth/me' && method === 'GET') {
    return json(res, 200, { user, state: publicState(user.id) });
  }

  if (pathname === '/api/state' && method === 'GET') {
    return json(res, 200, { user, state: publicState(user.id) });
  }

  if (pathname === '/api/lists' && method === 'POST') {
    const body = await readJson(req);
    const name = cleanText(body.name, 20);
    if (!name) return fail(res, 400, 'INVALID_LIST_NAME', '请填写分表名称。');
    const position = nextListPosition(user.id);
    const color = COLORS.includes(body.color) ? body.color : COLORS[position % COLORS.length];
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO lists (id, user_id, name, color, position, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, user.id, name, color, position, nowIso());
    return json(res, 201, { state: publicState(user.id) });
  }

  if (pathname === '/api/lists/reorder' && method === 'POST') {
    const body = await readJson(req);
    const ids = Array.isArray(body.listIds) ? body.listIds : [];
    const existing = db.prepare('SELECT id FROM lists WHERE user_id = ?').all(user.id).map((row) => row.id);
    if (ids.length !== existing.length || new Set(ids).size !== existing.length ||
        ids.some((id) => !existing.includes(id))) {
      return fail(res, 400, 'INVALID_LIST_ORDER', '分表排序数据已过期，请刷新后重试。');
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      ids.forEach((id, index) => {
        db.prepare('UPDATE lists SET position = ? WHERE id = ? AND user_id = ?').run(index, id, user.id);
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return json(res, 200, { state: publicState(user.id) });
  }

  const listMatch = pathname.match(/^\/api\/lists\/([^/]+)$/);
  if (listMatch) {
    const listId = decodeURIComponent(listMatch[1]);
    const list = ownedList(user.id, listId);
    if (!list) return fail(res, 404, 'LIST_NOT_FOUND', '没有找到这个分表。');

    if (method === 'PATCH') {
      const body = await readJson(req);
      const name = body.name === undefined ? list.name : cleanText(body.name, 20);
      const color = body.color === undefined ? list.color : body.color;
      if (!name) return fail(res, 400, 'INVALID_LIST_NAME', '分表名称不能为空。');
      if (!COLORS.includes(color)) return fail(res, 400, 'INVALID_COLOR', '请选择可用的分表颜色。');
      db.prepare('UPDATE lists SET name = ?, color = ? WHERE id = ? AND user_id = ?')
        .run(name, color, listId, user.id);
      return json(res, 200, { state: publicState(user.id) });
    }

    if (method === 'DELETE') {
      const body = await readJson(req);
      const openCount = Number(db.prepare(`
        SELECT COUNT(*) AS value FROM tasks
        WHERE user_id = ? AND list_id = ? AND status = 'open'
      `).get(user.id, listId).value);
      const mode = body.mode;

      if (openCount > 0 && !['transfer', 'delete'].includes(mode)) {
        return fail(res, 409, 'LIST_NOT_EMPTY', '这个分表里还有事项，请选择转移或一起删除。');
      }

      let target = null;
      if (openCount > 0 && mode === 'transfer') {
        target = ownedList(user.id, cleanText(body.targetListId, 80));
        if (!target || target.id === listId) {
          return fail(res, 400, 'INVALID_TARGET_LIST', '请选择一个其他分表接收事项。');
        }
      }

      db.exec('BEGIN IMMEDIATE');
      try {
        if (openCount > 0 && mode === 'transfer') {
          const { value } = db.prepare(`
            SELECT COALESCE(MAX(sort_order), -1) + 1 AS value
            FROM tasks WHERE user_id = ? AND task_date = ? AND status = 'open'
          `).get(user.id, today());
          db.prepare(`
            UPDATE tasks
            SET list_id = ?, source_list_id = ?, source_list_name = ?, sort_order = ?, updated_at = ?
            WHERE user_id = ? AND list_id = ? AND status = 'open'
          `).run(target.id, target.id, target.name, Number(value), nowIso(), user.id, listId);
        } else if (openCount > 0 && mode === 'delete') {
          db.prepare("DELETE FROM tasks WHERE user_id = ? AND list_id = ? AND status = 'open'")
            .run(user.id, listId);
        }

        db.prepare(`
          UPDATE tasks SET source_list_id = NULL
          WHERE user_id = ? AND source_list_id = ? AND status = 'completed'
        `).run(user.id, listId);

        db.prepare('DELETE FROM lists WHERE id = ? AND user_id = ?').run(listId, user.id);
        const remaining = db.prepare('SELECT id FROM lists WHERE user_id = ? ORDER BY position ASC, created_at ASC')
          .all(user.id);
        remaining.forEach((row, index) => {
          db.prepare('UPDATE lists SET position = ? WHERE id = ?').run(index, row.id);
        });
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }

      return json(res, 200, { state: publicState(user.id) });
    }
  }

  if (pathname === '/api/tasks' && method === 'POST') {
    const body = await readJson(req);
    const title = cleanText(body.title, 100);
    const list = ownedList(user.id, cleanText(body.listId, 80));
    if (!title) return fail(res, 400, 'INVALID_TITLE', '请填写事项名称。');
    if (!list) return fail(res, 400, 'INVALID_LIST', '请选择一个分表。');
    if (!isDate(body.date)) return fail(res, 400, 'INVALID_DATE', '请选择有效日期。');

    const id = crypto.randomUUID();
    const timestamp = nowIso();
    db.prepare(`
      INSERT INTO tasks (
        id, user_id, list_id, title, task_date, status, sort_order,
        source_list_id, source_list_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
    `).run(
      id, user.id, list.id, title, body.date,
      nextTaskOrder(user.id, body.date),
      list.id, list.name, timestamp, timestamp
    );
    return json(res, 201, { state: publicState(user.id) });
  }

  if (pathname === '/api/tasks/reorder' && method === 'POST') {
    const body = await readJson(req);
    const taskIds = Array.isArray(body.taskIds) ? body.taskIds : [];
    if (!taskIds.length || new Set(taskIds).size !== taskIds.length) {
      return fail(res, 400, 'INVALID_TASK_ORDER', '事项排序数据无效。');
    }
    const rows = taskIds.map((id) => ownedTask(user.id, id));
    if (rows.some((row) => !row || row.status !== 'open')) {
      return fail(res, 400, 'INVALID_TASK_ORDER', '事项排序数据已过期，请刷新后重试。');
    }
    if (new Set(rows.map((row) => row.task_date)).size !== 1) {
      return fail(res, 400, 'CROSS_DATE_ORDER', '不同日期的事项不能直接调整顺序。');
    }
    const taskDate = rows[0].task_date;
    const allForDate = db.prepare(`
      SELECT id FROM tasks
      WHERE user_id = ? AND task_date = ? AND status = 'open'
      ORDER BY sort_order ASC, created_at ASC
    `).all(user.id, taskDate).map((row) => row.id);
    if (allForDate.length !== taskIds.length || taskIds.some((id) => !allForDate.includes(id))) {
      return fail(res, 409, 'TASK_ORDER_STALE', '事项有更新，请刷新后重试。');
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      taskIds.forEach((id, index) => {
        db.prepare('UPDATE tasks SET sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?')
          .run(index, nowIso(), id, user.id);
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return json(res, 200, { state: publicState(user.id) });
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(complete|restore))?$/);
  if (taskMatch) {
    const taskId = decodeURIComponent(taskMatch[1]);
    const action = taskMatch[2];
    const task = ownedTask(user.id, taskId);
    if (!task) return fail(res, 404, 'TASK_NOT_FOUND', '没有找到这个事项。');

    if (method === 'DELETE' && !action) {
      db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(taskId, user.id);
      return json(res, 200, { state: publicState(user.id) });
    }

    if (method === 'PATCH' && !action) {
      const body = await readJson(req);
      if (task.status !== 'open') {
        return fail(res, 409, 'COMPLETED_TASK_LOCKED', '已完成事项只能恢复或删除。');
      }
      const title = body.title === undefined ? task.title : cleanText(body.title, 100);
      const taskDate = body.date === undefined ? task.task_date : body.date;
      if (!title) return fail(res, 400, 'INVALID_TITLE', '事项名称不能为空。');
      if (!isDate(taskDate)) return fail(res, 400, 'INVALID_DATE', '请选择有效日期。');

      if (body.listId !== undefined) {
        const target = ownedList(user.id, cleanText(body.listId, 80));
        if (!target) return fail(res, 400, 'INVALID_LIST', '请选择一个有效分表。');
        db.prepare(`
          UPDATE tasks SET
            title = ?, task_date = ?, list_id = ?, source_list_id = ?,
            source_list_name = ?, sort_order = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `).run(
          title, taskDate, target.id, target.id, target.name,
          nextTaskOrder(user.id, taskDate), nowIso(), taskId, user.id
        );
      } else {
        const dateChanged = taskDate !== task.task_date;
        const order = dateChanged ? nextTaskOrder(user.id, taskDate) : task.sort_order;
        db.prepare(`
          UPDATE tasks SET title = ?, task_date = ?, sort_order = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `).run(title, taskDate, order, nowIso(), taskId, user.id);
      }
      return json(res, 200, { state: publicState(user.id) });
    }

    if (action === 'complete' && method === 'POST') {
      if (task.status !== 'open') return fail(res, 409, 'TASK_ALREADY_COMPLETED', '这个事项已经完成。');
      const list = task.list_id ? ownedList(user.id, task.list_id) : null;
      const timestamp = new Date();
      db.prepare(`
        UPDATE tasks SET
          status = 'completed', list_id = NULL,
          source_list_id = ?, source_list_name = ?,
          completed_at = ?, completed_on = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND status = 'open'
      `).run(
        list ? list.id : task.source_list_id,
        list ? list.name : task.source_list_name,
        timestamp.toISOString(),
        dateInTimeZone(timestamp),
        timestamp.toISOString(),
        taskId,
        user.id
      );
      return json(res, 200, { state: publicState(user.id) });
    }

    if (action === 'restore' && method === 'POST') {
      if (task.status !== 'completed') return fail(res, 409, 'TASK_NOT_COMPLETED', '这个事项尚未完成。');
      const source = task.source_list_id ? ownedList(user.id, task.source_list_id) : null;
      if (!source) {
        return fail(res, 409, 'SOURCE_LIST_DELETED', '原分表已删除，这个事项不能恢复为未完成。');
      }
      db.prepare(`
        UPDATE tasks SET
          status = 'open', list_id = ?, source_list_id = ?, source_list_name = ?,
          sort_order = ?, completed_at = NULL, completed_on = NULL, updated_at = ?
        WHERE id = ? AND user_id = ?
      `).run(
        source.id, source.id, source.name,
        nextTaskOrder(user.id, task.task_date),
        nowIso(), taskId, user.id
      );
      return json(res, 200, { state: publicState(user.id) });
    }
  }

  return fail(res, 404, 'NOT_FOUND', '接口不存在。');
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(PUBLIC_DIR, `.${pathname}`);
  const publicRoot = path.resolve(PUBLIC_DIR) + path.sep;
  if (!filePath.startsWith(publicRoot)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(error.code === 'ENOENT' ? '未找到页面。' : '读取页面失败。');
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      fail(res, 500, 'SERVER_ERROR', '服务器暂时遇到问题，请稍后重试。');
    } else {
      res.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log(`轻待办已启动：${url}`);
  console.log('关闭此窗口即可停止运行。');
  if (process.env.NO_OPEN !== '1') {
    spawn('cmd.exe', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }).unref();
  }
});
