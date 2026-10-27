const COLORS = ['#9DBFB2', '#AEBFCE', '#C5B7D6', '#C5AEB6', '#BBC3A6', '#B7B0D5'];
const DAY_NAMES = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const HOLD_MS = 100;

const app = {
  user: null,
  state: null,
  selected: 'total',
  authMode: 'login',
  selectedColor: COLORS[0],
  menuTaskId: null,
  press: null,
  drag: null,
  tabPress: null,
  ignoreNextClick: false,
  confirmHandler: null,
  focusSession: null,
  focusTicker: null,
  focusPersistSecond: null,
  focusPage: 'setup'
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function icon(name, className = '') {
  return `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function parseLocalDate(dateText) {
  const [year, month, day] = dateText.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function dateText(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function addDays(dateString, amount) {
  const date = parseLocalDate(dateString);
  date.setDate(date.getDate() + amount);
  return dateText(date);
}

function relativeDateLabel(value, { includeWeekday = true } = {}) {
  const todayValue = app.state?.today || dateText(new Date());
  const date = parseLocalDate(value);
  const year = date.getFullYear() === new Date().getFullYear() ? '' : `${date.getFullYear()}年`;
  const main = `${year}${date.getMonth() + 1}月${date.getDate()}日`;
  let prefix = '';
  if (value === todayValue) prefix = '今天 · ';
  else if (value === addDays(todayValue, 1)) prefix = '明天 · ';
  else if (value === addDays(todayValue, -1)) prefix = '昨天 · ';
  return `${prefix}${main}${includeWeekday ? ` ${DAY_NAMES[date.getDay()]}` : ''}`;
}

function tinyDateLabel(value) {
  const date = parseLocalDate(value);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function daysPast(value) {
  const current = parseLocalDate(app.state.today);
  const target = parseLocalDate(value);
  return Math.max(1, Math.round((current - target) / 86400000));
}

function greeting() {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    hour12: false
  }).format(new Date()));
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function sortByOrder(tasks) {
  return [...tasks].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return String(a.created_at).localeCompare(String(b.created_at));
  });
}

function groupTasks(tasks, dateSelector, direction = 'asc') {
  const groups = new Map();
  for (const task of tasks) {
    const key = dateSelector(task);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }
  const keys = [...groups.keys()].sort((a, b) => direction === 'asc'
    ? a.localeCompare(b)
    : b.localeCompare(a));
  return keys.map((key) => ({
    key,
    tasks: sortByOrder(groups.get(key))
  }));
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'same-origin'
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    if (response.status === 401 && !url.includes('/auth/')) {
      showAuth();
    }
    const error = new Error(payload?.error?.message || '操作没有完成，请稍后再试。');
    error.code = payload?.error?.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function toast(message, type = '') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  $('#toastWrap').append(item);
  setTimeout(() => {
    item.style.opacity = '0';
    item.style.transform = 'translateY(5px)';
    setTimeout(() => item.remove(), 220);
  }, 2500);
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.textContent = label || '正在处理…';
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
  }
}

function setState(state) {
  app.state = state;
  renderAll();
}

function showAuth() {
  stopFocusTicker();
  app.focusSession = null;
  $('#focusShell')?.classList.add('hidden');
  $('#appShell')?.classList.add('hidden');
  document.body.classList.remove('focus-mode');
  document.title = '轻待办';
  app.user = null;
  app.state = null;
  closeAllDialogs();
  $('#appShell').classList.add('hidden');
  $('#authScreen').classList.remove('hidden');
  $('#authPassword').value = '';
  switchAuthMode('login');
  setTimeout(() => $('#authUsername').focus(), 30);
}

function showApp(user, state) {
  app.user = user;
  app.state = state;
  app.selected = 'total';
  $('#authScreen').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  $('#userInitial').textContent = [...user.username][0]?.toUpperCase() || '我';
  $('#userName').textContent = user.username;
  $('#topDate').textContent = relativeDateLabel(state.today);
  renderAll();
  restoreSavedFocusSession();
}

function switchAuthMode(mode) {
  app.authMode = mode;
  $$('.auth-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.authTab === mode));
  const register = mode === 'register';
  $('#authTitle').textContent = register ? '从一个名字开始' : '先坐一会儿吧';
  $('#authHint').textContent = register
    ? '只需用户名和密码，今天的事项就会有自己的位置。'
    : '登录后，今天的事项会在这里安静等你。';
  $('#authSubmit span').textContent = register ? '创建我的清单' : '进入我的清单';
  $('#authPassword').autocomplete = register ? 'new-password' : 'current-password';
  $('#authError').textContent = '';
}

function selectedUserList() {
  if (!app.state) return null;
  return app.state.lists.find((list) => list.id === app.selected) || null;
}

function taskById(id) {
  if (!app.state) return null;
  return app.state.openTasks.find((task) => task.id === id) ||
    app.state.completedTasks.find((task) => task.id === id) ||
    null;
}

function renderAll() {
  if (!app.state || !app.user) return;
  $('#topDate').textContent = relativeDateLabel(app.state.today);
  renderTabs();
  renderView();
}

const FOCUS_STORAGE_PREFIX = 'light-todo-focus-v1:';

function focusStorageKey() {
  return app.user ? `${FOCUS_STORAGE_PREFIX}${app.user.id}` : '';
}

function clearFocusStorage() {
  const key = focusStorageKey();
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {}
}

function saveFocusSession() {
  if (!app.focusSession || !app.user || app.focusSession.setup) return;
  try {
    localStorage.setItem(focusStorageKey(), JSON.stringify({
      userId: app.user.id,
      ...app.focusSession
    }));
  } catch {}
}

function stopFocusTicker() {
  if (app.focusTicker) {
    clearInterval(app.focusTicker);
    app.focusTicker = null;
  }
}

function showFocusSetup(task) {
  if (!task || task.status !== 'open') return;
  stopFocusTicker();
  app.focusSession = {
    taskId: task.id,
    title: task.title,
    totalMs: 25 * 60 * 1000,
    remainingMs: 25 * 60 * 1000,
    endAt: null,
    running: false,
    finished: false,
    mode: 'flip',
    setup: true
  };
  $('#focusSetupTaskTitle').textContent = task.title;
  $('#focusMinutes').value = '25';
  $('#focusSeconds').value = '0';
  $('#focusSetupError').textContent = '';
  $$('input[name="focusMode"]').forEach((input) => {
    input.checked = input.value === 'flip';
  });
  setFocusPresetSelection(25);
  showFocusPage('setup');
}

function setFocusPresetSelection(minutes) {
  $$('#focusPresets button').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.focusMinutes) === minutes);
  });
}

function setFocusDurationFromMinutes(minutes) {
  $('#focusMinutes').value = String(Math.min(99, minutes));
  $('#focusSeconds').value = '0';
  setFocusPresetSelection(minutes);
  $('#focusSetupError').textContent = '';
}

function readFocusDurationMs() {
  const minutes = Math.max(0, Math.min(99, Number.parseInt($('#focusMinutes').value || '0', 10) || 0));
  const seconds = Math.max(0, Math.min(59, Number.parseInt($('#focusSeconds').value || '0', 10) || 0));
  return (minutes * 60 + seconds) * 1000;
}

function setFocusDurationInputs(totalMs) {
  const totalSeconds = Math.min(99 * 60 + 59, Math.max(0, Math.floor(totalMs / 1000)));
  $('#focusMinutes').value = String(Math.floor(totalSeconds / 60));
  $('#focusSeconds').value = String(totalSeconds % 60);
}

function showFocusPage(page) {
  app.focusPage = page;
  $('#appShell').classList.add('hidden');
  $('#focusShell').classList.remove('hidden');
  $('#focusSetupPage').classList.toggle('hidden', page !== 'setup');
  $('#focusClockPage').classList.toggle('hidden', page !== 'clock');
  $('#focusShell').classList.toggle('clock-mode', page === 'clock');
  document.body.classList.add('focus-mode');
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function hideFocusPage() {
  stopFocusTicker();
  app.focusSession = null;
  app.focusPage = 'setup';
  clearFocusStorage();
  $('#focusShell').classList.add('hidden');
  $('#focusShell').classList.remove('clock-mode');
  $('#appShell').classList.remove('hidden');
  document.body.classList.remove('focus-mode');
  document.title = '轻待办';
  if (app.state) renderAll();
}

function startFocusCountdown() {
  const totalMs = readFocusDurationMs();
  if (totalMs <= 0) {
    $('#focusSetupError').textContent = '请设置一个大于 0 秒的专注时间。';
    return;
  }
  const mode = $('input[name="focusMode"]:checked')?.value === 'analog' ? 'analog' : 'flip';
  const task = app.state.openTasks.find((item) => item.id === app.focusSession?.taskId);
  if (!task) {
    toast('这个事项已经不存在或已完成。', 'error');
    hideFocusPage();
    return;
  }
  app.focusSession = {
    taskId: task.id,
    title: task.title,
    totalMs,
    remainingMs: totalMs,
    endAt: Date.now() + totalMs,
    running: true,
    finished: false,
    mode,
    setup: false
  };
  app.focusPersistSecond = Math.ceil(totalMs / 1000);
  showFocusClock();
  saveFocusSession();
}

function showFocusClock() {
  if (!app.focusSession) return;
  $('#focusClockTask').textContent = app.focusSession.title;
  $('#focusClockPage').classList.toggle('finished', app.focusSession.finished);
  $('#focusFinishedActions').classList.toggle('hidden', !app.focusSession.finished);
  showFocusPage('clock');
  renderFocusClock();
  startFocusTicker();
}

function startFocusTicker() {
  stopFocusTicker();
  if (!app.focusSession) return;
  if (app.focusSession.running) {
    updateFocusRemaining();
    app.focusTicker = setInterval(updateFocusRemaining, 100);
  }
}

function updateFocusRemaining() {
  const session = app.focusSession;
  if (!session) return;
  if (session.running && session.endAt) {
    session.remainingMs = Math.max(0, session.endAt - Date.now());
    if (session.remainingMs <= 0) {
      session.remainingMs = 0;
      session.running = false;
      session.finished = true;
      session.endAt = null;
      session.setup = false;
      stopFocusTicker();
      saveFocusSession();
    } else {
      const displaySecond = Math.ceil(session.remainingMs / 1000);
      if (app.focusPersistSecond !== displaySecond) {
        app.focusPersistSecond = displaySecond;
        saveFocusSession();
      }
    }
  }
  renderFocusClock();
}

function focusTimeParts(session) {
  const totalSeconds = Math.max(0, Math.min(99 * 60 + 59, Math.ceil(session.remainingMs / 1000)));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const minuteText = String(minutes).padStart(2, '0');
  const secondText = String(seconds).padStart(2, '0');
  return {
    units: [...minuteText, ...secondText],
    text: `${minuteText}:${secondText}`
  };
}

function buildFlipClock(unitCount) {
  const root = $('#focusFlipClock');
  if (Number(root.dataset.unitCount) === unitCount) return;
  root.dataset.unitCount = String(unitCount);
  root.classList.toggle('units-4', unitCount === 4);
  root.innerHTML = Array.from({ length: unitCount }, (_, index) => {
    const colon = index === 2 ? '<span class="flip-colon" aria-hidden="true"><span></span><span></span></span>' : '';
    return `${colon}
      <div class="flip-unit" data-flip-unit="${index}" data-value="">
        <div class="flip-half top"><span class="flip-digit" data-flip-face="top-static">0</span></div>
        <div class="flip-half bottom"><span class="flip-digit" data-flip-face="bottom-static">0</span></div>
        <div class="flip-half top flip-flap"><span class="flip-digit" data-flip-face="top-flap">0</span></div>
        <div class="flip-half bottom flip-flap"><span class="flip-digit" data-flip-face="bottom-flap">0</span></div>
      </div>`;
  }).join('');
}

function setFlipUnit(unit, value, animate = true) {
  const oldValue = unit.dataset.value || value;
  const topStatic = $('[data-flip-face="top-static"]', unit);
  const bottomStatic = $('[data-flip-face="bottom-static"]', unit);
  const topFlap = $('[data-flip-face="top-flap"]', unit);
  const bottomFlap = $('[data-flip-face="bottom-flap"]', unit);
  if (!topStatic || !bottomStatic || !topFlap || !bottomFlap) return;

  if (oldValue === value) {
    if (!animate) {
      topStatic.textContent = value;
      bottomStatic.textContent = value;
      topFlap.textContent = value;
      bottomFlap.textContent = value;
    }
    unit.dataset.value = value;
    return;
  }

  if (unit.flipTimer) clearTimeout(unit.flipTimer);
  unit.classList.remove('flipping');
  topStatic.textContent = value;
  bottomStatic.textContent = oldValue;
  topFlap.textContent = oldValue;
  bottomFlap.textContent = value;
  unit.dataset.value = value;

  if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    void unit.offsetWidth;
    unit.classList.add('flipping');
    unit.flipTimer = setTimeout(() => {
      topFlap.textContent = value;
      bottomStatic.textContent = value;
      bottomFlap.textContent = value;
      unit.classList.remove('flipping');
      unit.flipTimer = null;
    }, 610);
  } else {
    bottomStatic.textContent = value;
  }
}

function buildAnalogClock() {
  const ticks = $('#analogClockTicks');
  if (ticks.childElementCount) return;
  for (let index = 0; index < 60; index += 1) {
    const angle = index * 6 * Math.PI / 180;
    const major = index % 5 === 0;
    const outerRadius = 209;
    const innerRadius = major ? 190 : 199;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', (250 + Math.sin(angle) * innerRadius).toFixed(2));
    line.setAttribute('y1', (250 - Math.cos(angle) * innerRadius).toFixed(2));
    line.setAttribute('x2', (250 + Math.sin(angle) * outerRadius).toFixed(2));
    line.setAttribute('y2', (250 - Math.cos(angle) * outerRadius).toFixed(2));
    if (major) line.setAttribute('class', 'major');
    ticks.append(line);
  }
}

function renderFocusClock() {
  const session = app.focusSession;
  if (!session) return;
  const parts = focusTimeParts(session);
  const mode = session.mode || 'flip';
  const flipRoot = $('#focusFlipClock');
  const analogRoot = $('#focusAnalogClock');
  flipRoot.classList.toggle('hidden', mode !== 'flip');
  analogRoot.classList.toggle('hidden', mode !== 'analog');
  const timerLabel = `${session.title}，剩余 ${parts.text}`;
  flipRoot.setAttribute('aria-label', timerLabel);
  analogRoot.setAttribute('aria-label', timerLabel);

  if (mode === 'flip') {
    const freshClock = Number(flipRoot.dataset.unitCount) !== parts.units.length;
    buildFlipClock(parts.units.length);
    $$('.flip-unit', flipRoot).forEach((unit, index) => {
      setFlipUnit(unit, parts.units[index], !freshClock && session.remainingMs < session.totalMs);
    });
  } else {
    buildAnalogClock();
    const progress = session.totalMs > 0 ? session.remainingMs / session.totalMs : 0;
    const totalMinutes = session.totalMs / 60000;
    const scaleLabel = (ratio) => {
      const minutes = totalMinutes * ratio;
      if (minutes <= 0) return '0分';
      return `${Math.ceil(minutes)}分`;
    };
    $('#analogLabelStart').textContent = scaleLabel(1);
    $('#analogLabel75').textContent = scaleLabel(.75);
    $('#analogLabel50').textContent = scaleLabel(.5);
    $('#analogLabel25').textContent = scaleLabel(.25);
    $('#analogLabelEnd').textContent = '0分';
    $('#analogCountdownHand').style.transform = `rotate(${-(1 - progress) * 360}deg)`;
  }

  $('#focusClockPage').classList.toggle('finished', session.finished);
  $('#focusFinishedActions').classList.toggle('hidden', !session.finished);
  $('#focusPauseButton').disabled = session.finished;
  const pauseLabel = $('span', $('#focusPauseButton'));
  const pauseIcon = $('svg use', $('#focusPauseButton'));
  pauseLabel.textContent = session.finished ? '已结束' : session.running ? '暂停' : '继续';
  pauseIcon?.setAttribute('href', session.running ? '#i-pause' : '#i-play');
  $('#focusModeButton span').textContent = mode === 'flip' ? '切换圆形钟' : '切换翻页钟';
  $('#focusModeButton use')?.setAttribute('href', mode === 'flip' ? '#i-timer' : '#i-grid-clock');
  $('#focusClockStatus').textContent = session.finished
    ? '时间到了。今天就到这里，辛苦了。'
    : session.running
      ? '保持呼吸，专注于这一件事。'
      : '计时已暂停，可以随时继续。';
  document.title = session.finished ? '时间到了 · 轻待办' : `${parts.text} · 专注中`;
}

function toggleFocusPause() {
  const session = app.focusSession;
  if (!session || session.finished) return;
  if (session.running) {
    session.remainingMs = Math.max(0, session.endAt - Date.now());
    session.running = false;
    session.endAt = null;
    stopFocusTicker();
  } else {
    if (session.remainingMs <= 0) return;
    session.running = true;
    session.endAt = Date.now() + session.remainingMs;
    startFocusTicker();
  }
  saveFocusSession();
  renderFocusClock();
}

function toggleFocusMode() {
  const session = app.focusSession;
  if (!session) return;
  session.mode = session.mode === 'flip' ? 'analog' : 'flip';
  saveFocusSession();
  renderFocusClock();
}

function restartFocusSetup() {
  const session = app.focusSession;
  if (!session) return;
  stopFocusTicker();
  const task = app.state.openTasks.find((item) => item.id === session.taskId);
  if (!task) {
    hideFocusPage();
    return;
  }
  $('#focusSetupTaskTitle').textContent = task.title;
  setFocusDurationInputs(session.totalMs);
  setFocusPresetSelection(null);
  $$('input[name="focusMode"]').forEach((input) => {
    input.checked = input.value === session.mode;
  });
  app.focusSession = {
    ...session,
    remainingMs: session.totalMs,
    running: false,
    finished: false,
    endAt: null,
    setup: true
  };
  clearFocusStorage();
  showFocusPage('setup');
}

function requestExitFocus() {
  if (!app.focusSession) {
    hideFocusPage();
    return;
  }
  if (app.focusSession.running) {
    openConfirm({
      eyebrow: '专注中',
      title: '结束这次专注？',
      description: '当前倒计时会停止，但不会改变这件待办事项的状态。',
      label: '结束专注',
      action: async () => hideFocusPage()
    });
  } else {
    hideFocusPage();
  }
}

async function completeTaskFromFocus() {
  const session = app.focusSession;
  if (!session) return;
  const button = $('#focusCompleteTaskButton');
  setBusy(button, true, '正在完成…');
  try {
    const result = await api(`/api/tasks/${encodeURIComponent(session.taskId)}/complete`, { method: 'POST' });
    setState(result.state);
    hideFocusPage();
    toast('完成一件，辛苦了。');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

function restoreSavedFocusSession() {
  if (!app.user || !app.state) return;
  try {
    const raw = localStorage.getItem(focusStorageKey());
    if (!raw) return;
    const saved = JSON.parse(raw);
    const task = app.state.openTasks.find((item) => item.id === saved.taskId);
    if (!task) {
      clearFocusStorage();
      return;
    }
    const now = Date.now();
    const remaining = saved.running && saved.endAt
      ? Math.max(0, saved.endAt - now)
      : Math.max(0, Number(saved.remainingMs) || 0);
    app.focusSession = {
      ...saved,
      title: task.title,
      totalMs: Math.min(99 * 60 * 1000 + 59000, Math.max(1000, Number(saved.totalMs) || 1500000)),
      remainingMs: remaining,
      running: Boolean(saved.running && remaining > 0),
      finished: remaining <= 0,
      endAt: saved.running && remaining > 0 ? saved.endAt : null,
      setup: false
    };
    app.focusSession.remainingMs = Math.min(app.focusSession.remainingMs, app.focusSession.totalMs);
    if (app.focusSession.finished) {
      app.focusSession.running = false;
      app.focusSession.endAt = null;
    }
    showFocusClock();
  } catch {
    clearFocusStorage();
  }
}

function renderTabs() {
  const tabs = $('#listTabs');
  const lists = app.state.lists;
  const totalCount = app.state.openTasks.filter((task) => task.date === app.state.today).length;
  const overdueCount = app.state.openTasks.filter((task) => task.date < app.state.today).length;
  const completedCount = app.state.completedTasks.length;

  const html = [
    `<button class="list-tab total-list ${app.selected === 'total' ? 'active' : ''}" data-view="total" type="button">
      ${icon('spark')}<span>今日总表</span>${totalCount ? `<span class="tab-count">${totalCount}</span>` : ''}
    </button>`,
    ...lists.map((list) => `
      <button class="list-tab ${app.selected === list.id ? 'active' : ''}"
        data-view="${escapeHtml(list.id)}" data-list-id="${escapeHtml(list.id)}"
        style="--tab-color:${escapeHtml(list.color)}" type="button">
        <span class="tab-dot"></span><span>${escapeHtml(list.name)}</span>
        ${Number(list.open_count) ? `<span class="tab-count">${Number(list.open_count)}</span>` : ''}
      </button>
    `),
    '<span class="tab-divider"></span>',
    `<button class="list-tab ${app.selected === 'overdue' ? 'active' : ''}" data-view="overdue" type="button">
      <span class="tab-dot" style="--tab-color:var(--rose)"></span><span>逾期事项</span>
      ${overdueCount ? `<span class="tab-count">${overdueCount}</span>` : ''}
    </button>`,
    `<button class="list-tab ${app.selected === 'completed' ? 'active' : ''}" data-view="completed" type="button">
      <span class="tab-dot" style="--tab-color:var(--sage)"></span><span>已完成</span>
      ${completedCount ? `<span class="tab-count">${completedCount}</span>` : ''}
    </button>`
  ];
  tabs.innerHTML = html.join('');
}

function taskRow(task, options = {}) {
  const completed = options.completed || task.status === 'completed';
  const overdue = options.overdue || (!completed && task.date < app.state.today);
  const color = completed ? task.source_list_color : task.list_color;
  const listName = completed ? task.source_list_name : task.list_name;
  const draggable = options.draggable !== false && !completed;
  const dateLabel = options.showDate === false ? '' : tinyDateLabel(task.date);
  const canRestore = completed ? Number(task.can_restore) === 1 : true;
  const restoreTitle = completed && !canRestore ? '原分表已删除，不能恢复' : completed ? '恢复为未完成' : '标记完成';
  return `
    <article class="task-row ${completed ? 'completed-row' : ''} ${overdue ? 'overdue-row' : ''}"
      data-task-id="${escapeHtml(task.id)}" data-date="${escapeHtml(task.date)}"
      data-draggable="${draggable ? 'true' : 'false'}"
      style="--list-color:${escapeHtml(color)}">
      <button class="task-check" data-toggle-task="${escapeHtml(task.id)}"
        type="button" title="${restoreTitle}" aria-label="${restoreTitle}">
        ${icon('check')}
      </button>
      <div class="task-body">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-meta">
          ${options.showList === false ? '' : `<span class="list-pill">${escapeHtml(listName)}</span>`}
          ${dateLabel ? `<span>${icon('calendar')}${escapeHtml(dateLabel)}</span>` : ''}
          ${overdue ? `<span class="overdue-badge">逾期 ${daysPast(task.date)} 天</span>` : ''}
          ${completed && task.completed_on ? `<span>${escapeHtml(tinyDateLabel(task.completed_on))}完成</span>` : ''}
        </div>
      </div>
      <div class="task-actions">
        ${completed ? '' : `<button class="focus-task-button" data-focus-task="${escapeHtml(task.id)}" type="button" title="现在做">${icon('timer')}<span>现在做</span></button>`}
        ${completed && canRestore ? `<button class="restore-button" data-restore-task="${escapeHtml(task.id)}" type="button" title="恢复为未完成">${icon('restore')}</button>` : ''}
        <button class="task-menu-button" data-task-menu="${escapeHtml(task.id)}" type="button" title="更多操作" aria-label="更多操作">${icon('more')}</button>
      </div>
    </article>
  `;
}

function taskSection({ title, count, note = '', body, className = '' }) {
  return `
    <section class="task-section ${className}">
      <div class="section-header">
        <h3>${escapeHtml(title)}</h3>
        <span class="section-count">${count}</span>
        ${note ? `<span class="section-note">${escapeHtml(note)}</span>` : ''}
      </div>
      ${body}
    </section>
  `;
}

function flatGroup(tasks, options = {}) {
  return `<div class="task-group-list" data-task-group data-group-date="${escapeHtml(options.date || '')}">
    ${tasks.map((task) => taskRow(task, options)).join('')}
  </div>`;
}

function dateGroups(tasks, direction, options = {}) {
  return groupTasks(tasks, (task) => task.date, direction).map((group) => `
    <div class="date-group">
      <div class="date-heading">${escapeHtml(relativeDateLabel(group.key))}</div>
      ${flatGroup(group.tasks, { ...options, date: group.key })}
    </div>
  `).join('');
}

function completedGroups(tasks) {
  const groups = new Map();
  for (const task of tasks) {
    const key = task.completed_on || task.date;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }
  return [...groups.keys()].sort((a, b) => b.localeCompare(a)).map((date) => `
    <div class="date-group">
      <div class="date-heading">${escapeHtml(relativeDateLabel(date, { includeWeekday: false }))}完成</div>
      <div class="task-group-list">
        ${groups.get(date).map((task) => taskRow(task, {
          completed: true,
          draggable: false,
          showDate: true
        })).join('')}
      </div>
    </div>
  `).join('');
}

function setHero({ eyebrow, title, subtitle, count, label, percentage }) {
  $('#heroEyebrow').textContent = eyebrow;
  $('#viewTitle').textContent = title;
  $('#viewSubtitle').textContent = subtitle;
  $('#progressNumber').textContent = count;
  $('#progressLabel').textContent = label;
  $('#progressRing').style.setProperty('--progress', `${Math.max(0, Math.min(100, percentage)) * 3.6}deg`);
}

function animatePendingCount(previousCount) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const number = $('#progressNumber');
  const target = Number(number.textContent);
  if (!Number.isFinite(previousCount) || !Number.isFinite(target) || previousCount === target) return;

  const start = performance.now();
  const duration = 520;
  number.animate(
    [
      { opacity: .45, transform: 'translateY(5px) scale(.94)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' }
    ],
    { duration: 420, easing: 'cubic-bezier(.2,.75,.25,1)' }
  );
  $('#progressRing').animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.055)', offset: .54 },
      { transform: 'scale(1)' }
    ],
    { duration: 620, easing: 'cubic-bezier(.22,.72,.24,1)' }
  );
  $('#progressLabel').animate(
    [
      { opacity: .35, transform: 'translateY(3px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ],
    { duration: 440, delay: 60, easing: 'cubic-bezier(.2,.72,.24,1)' }
  );

  function frame(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    number.textContent = String(Math.round(previousCount + (target - previousCount) * eased));
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function renderView() {
  const state = app.state;
  const open = state.openTasks;
  const todayOpen = sortByOrder(open.filter((task) => task.date === state.today));
  const overdue = sortByOrder(open.filter((task) => task.date < state.today));
  const completedToday = state.completedTasks.filter((task) => task.completed_on === state.today);
  const selectedList = selectedUserList();
  let html = '';
  let totalVisible = 0;

  $('#listSettingsButton').classList.toggle('hidden', !selectedList);

  if (app.selected === 'total') {
    const hasOverdue = overdue.length > 0;
    $('#panelKicker').textContent = 'TODAY';
    $('#panelTitle').textContent = '今日事项';
    setHero({
      eyebrow: `今日 · ${greeting()}`,
      title: todayOpen.length ? '今天，做一点点。' : '今天，留一点空白。',
      subtitle: hasOverdue
        ? '还有几件旧事，也可以慢慢收尾。'
        : completedToday.length
          ? `今天已经完成 ${completedToday.length} 件，给自己一点掌声。`
          : '先把眼前的小事照顾好。',
      count: todayOpen.length,
      label: todayOpen.length ? '件待完成' : '今天还空着呢',
      percentage: completedToday.length + todayOpen.length
        ? completedToday.length / (completedToday.length + todayOpen.length) * 100
        : 0
    });

    if (todayOpen.length) {
      html += taskSection({
        title: '今天未完成',
        count: todayOpen.length,
        note: '同一日期内可拖动排序',
        body: flatGroup(todayOpen, { date: state.today, showList: true })
      });
    }

    if (hasOverdue) {
      html += taskSection({
        title: '逾期事项',
        count: overdue.length,
        note: '日期最近的在上面',
        body: dateGroups(overdue, 'desc', { overdue: true, showList: true }),
        className: 'overdue-section'
      });
    } else if (completedToday.length) {
      html += taskSection({
        title: '今日已完成',
        count: completedToday.length,
        note: '最近完成的在上面',
        body: flatGroup(completedToday, { completed: true, draggable: false, showList: true }),
        className: 'completed-section'
      });
    }
    totalVisible = todayOpen.length + (hasOverdue ? overdue.length : completedToday.length);
  } else if (app.selected === 'overdue') {
    $('#panelKicker').textContent = 'OVERDUE';
    $('#panelTitle').textContent = '逾期事项';
    setHero({
      eyebrow: '过去 · 慢慢收尾',
      title: overdue.length ? '还没做完，也没关系。' : '过去的事情，都已经安放好了。',
      subtitle: overdue.length ? '它们不会消失，会在这里提醒你。' : '没有逾期事项，轻松一点。',
      count: overdue.length,
      label: overdue.length ? '件待收尾' : '没有逾期',
      percentage: overdue.length ? 20 : 100
    });
    if (overdue.length) {
      html += taskSection({
        title: '全部逾期',
        count: overdue.length,
        note: '不同日期之间不能拖动',
        body: dateGroups(overdue, 'desc', { overdue: true, showList: true })
      });
    }
    totalVisible = overdue.length;
  } else if (app.selected === 'completed') {
    $('#panelKicker').textContent = 'COMPLETED';
    $('#panelTitle').textContent = '已完成';
    setHero({
      eyebrow: '完成 · 都有回声',
      title: '每一件完成，都有回声。',
      subtitle: state.completedTasks.length
        ? `已经认真完成了 ${state.completedTasks.length} 件小事。`
        : '完成第一件事后，它会安静地来到这里。',
      count: state.completedTasks.length,
      label: state.completedTasks.length ? '件已完成' : '还没有记录',
      percentage: state.completedTasks.length ? 100 : 0
    });
    if (state.completedTasks.length) {
      html += taskSection({
        title: '完成记录',
        count: state.completedTasks.length,
        note: '保留原分表与日期',
        body: completedGroups(state.completedTasks)
      });
    }
    totalVisible = state.completedTasks.length;
  } else if (selectedList) {
    const listOpen = open.filter((task) => task.list_id === selectedList.id);
    const currentAndFuture = sortByOrder(listOpen.filter((task) => task.date >= state.today));
    const listOverdue = sortByOrder(listOpen.filter((task) => task.date < state.today));
    $('#panelKicker').textContent = 'YOUR LIST';
    $('#panelTitle').textContent = selectedList.name;
    setHero({
      eyebrow: `${selectedList.name} · 自有节奏`,
      title: `${selectedList.name}，按自己的节奏。`,
      subtitle: currentAndFuture.length
        ? `从今天到以后，一共有 ${currentAndFuture.length} 件计划。`
        : '这个分表暂时很轻。',
      count: currentAndFuture.length,
      label: currentAndFuture.length ? '件待完成' : '暂时空着',
      percentage: currentAndFuture.length ? 18 : 100
    });
    if (currentAndFuture.length) {
      html += taskSection({
        title: '今天与未来',
        count: currentAndFuture.length,
        note: '按日期从近到远',
        body: dateGroups(currentAndFuture, 'asc', { showList: false })
      });
    }
    if (listOverdue.length) {
      html += taskSection({
        title: '逾期事项',
        count: listOverdue.length,
        note: '仍然属于这个分表',
        body: dateGroups(listOverdue, 'desc', { overdue: true, showList: false })
      });
    }
    totalVisible = currentAndFuture.length + listOverdue.length;
  }

  const content = $('#taskContent');
  content.innerHTML = html;
  content.classList.toggle('hidden', totalVisible === 0);
  $('#emptyState').classList.toggle('hidden', totalVisible !== 0);
  if (totalVisible === 0) {
    renderEmptyState();
  }
}

function renderEmptyState() {
  const selected = app.selected;
  let title = '今天很安静';
  let text = '没有待办，也是一件值得高兴的小事。';
  if (selected === 'completed') {
    title = '还没有完成记录';
    text = '完成一件事后，它会安静地来到这里。';
  } else if (selected === 'overdue') {
    title = '没有逾期事项';
    text = '过去的事情都已经安放好了。';
  } else if (selected !== 'total') {
    title = '这个分表还很轻';
    text = '可以记下一件今天或未来的小事。';
  }
  $('#emptyTitle').textContent = title;
  $('#emptyText').textContent = text;
  $('#emptyAddButton').classList.toggle('hidden', selected === 'overdue' || selected === 'completed');
}

function colorOptions(selectedColor) {
  return COLORS.map((color) => `
    <button type="button" class="color-choice ${color === selectedColor ? 'selected' : ''}"
      data-color="${color}" style="--choice-color:${color}" aria-label="选择颜色 ${color}">
      <span></span>
    </button>
  `).join('');
}

function openTaskDialog(task = null) {
  if (!app.state.lists.length) {
    toast('请先新建一个分表。');
    openListDialog();
    return;
  }
  const selectedList = selectedUserList();
  $('#taskForm').reset();
  $('#taskId').value = task?.id || '';
  $('#taskTitle').value = task?.title || '';
  $('#taskDate').value = task?.date || app.state.today;
  $('#taskDate').min = '1900-01-01';
  $('#taskList').innerHTML = app.state.lists.map((list) => `
    <option value="${escapeHtml(list.id)}">${escapeHtml(list.name)}</option>
  `).join('');
  $('#taskList').value = task?.list_id || selectedList?.id || app.state.lists[0].id;
  $('#taskDialogEyebrow').textContent = task ? '修改一下' : '记下今天';
  $('#taskDialogTitle').textContent = task ? '修改这件事' : '一件小事';
  $('#taskSubmitLabel').textContent = task ? '保存修改' : '记下来';
  $('#taskError').textContent = '';
  $('#taskDialog').showModal();
  setTimeout(() => $('#taskTitle').focus(), 50);
}

async function submitTask(event) {
  event.preventDefault();
  const button = event.submitter || $('#taskForm .primary-button');
  const id = $('#taskId').value;
  const body = {
    title: $('#taskTitle').value,
    date: $('#taskDate').value,
    listId: $('#taskList').value
  };
  setBusy(button, true, '正在保存…');
  try {
    const result = await api(id ? `/api/tasks/${encodeURIComponent(id)}` : '/api/tasks', {
      method: id ? 'PATCH' : 'POST',
      body
    });
    setState(result.state);
    $('#taskDialog').close();
    toast(id ? '事项已经更新。' : '已经记下来了。');
  } catch (error) {
    $('#taskError').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function openListDialog(list = null) {
  $('#listForm').reset();
  $('#listId').value = list?.id || '';
  $('#listName').value = list?.name || '';
  $('#listDialogTitle').textContent = list ? '分表设置' : '新建分表';
  $('#deleteListButton').classList.toggle('hidden', !list);
  app.selectedColor = list?.color || COLORS[app.state.lists.length % COLORS.length];
  $('#colorOptions').innerHTML = colorOptions(app.selectedColor);
  $('#listError').textContent = '';
  $('#listDialog').showModal();
  setTimeout(() => $('#listName').focus(), 50);
}

async function submitList(event) {
  event.preventDefault();
  const button = event.submitter || $('#listForm .primary-button');
  const id = $('#listId').value;
  setBusy(button, true, '正在保存…');
  try {
    const result = await api(id ? `/api/lists/${encodeURIComponent(id)}` : '/api/lists', {
      method: id ? 'PATCH' : 'POST',
      body: { name: $('#listName').value, color: app.selectedColor }
    });
    if (!id) {
      const previousIds = new Set(app.state.lists.map((item) => item.id));
      const created = result.state.lists.find((item) => !previousIds.has(item.id));
      if (created) app.selected = created.id;
    }
    setState(result.state);
    $('#listDialog').close();
    toast(id ? '分表设置已保存。' : '新分表创建好了。');
  } catch (error) {
    $('#listError').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function openDeleteListDialog() {
  const listId = $('#listId').value;
  const list = app.state.lists.find((item) => item.id === listId);
  if (!list) return;
  $('#listDialog').close();
  const others = app.state.lists.filter((item) => item.id !== list.id);
  const count = Number(list.open_count);
  $('#deleteListForm').reset();
  $('#deleteListForm').dataset.listId = list.id;
  $('#deleteListTitle').textContent = count ? '这个分表里还有事项' : `删除“${list.name}”？`;
  $('#deleteListDescription').textContent = count
    ? `“${list.name}”中有 ${count} 件未完成事项。已完成的记录会保留，原分表被删除后不能恢复为未完成。`
    : '分表会从底部导航中移除，已有完成记录仍会保留。';
  $('#deleteListOptions').classList.toggle('hidden', !count);
  $('#transferTargetField').classList.add('hidden');
  $('#deleteTargetList').innerHTML = others.map((item) => `
    <option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>
  `).join('');
  const transferRadio = $('#deleteTransferChoice');
  transferRadio.disabled = others.length === 0;
  $('#deleteAllChoice').checked = true;
  if (others.length) {
    transferRadio.checked = true;
    $('#transferTargetField').classList.remove('hidden');
  }
  $('#deleteListError').textContent = '';
  $('#deleteListDialog').showModal();
}

async function submitDeleteList(event) {
  event.preventDefault();
  const button = event.submitter || $('#deleteListForm .danger-button');
  const listId = $('#deleteListForm').dataset.listId;
  const list = app.state.lists.find((item) => item.id === listId);
  const count = Number(list?.open_count || 0);
  const mode = $('input[name="deleteMode"]:checked')?.value;
  const body = count ? { mode, targetListId: $('#deleteTargetList').value } : {};
  setBusy(button, true, '正在删除…');
  try {
    const result = await api(`/api/lists/${encodeURIComponent(listId)}`, {
      method: 'DELETE',
      body
    });
    if (app.selected === listId) app.selected = 'total';
    setState(result.state);
    $('#deleteListDialog').close();
    toast('分表已经删除。');
  } catch (error) {
    $('#deleteListError').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function openConfirm({ title, description, eyebrow = '请确认', label = '确认删除', action }) {
  $('#confirmTitle').textContent = title;
  $('#confirmDescription').textContent = description;
  $('#confirmEyebrow').textContent = eyebrow;
  $('#confirmAction').textContent = label;
  app.confirmHandler = action;
  $('#confirmDialog').showModal();
}

async function submitConfirm(event) {
  event.preventDefault();
  if (!app.confirmHandler) return;
  const button = event.submitter || $('#confirmAction');
  setBusy(button, true, '正在处理…');
  try {
    await app.confirmHandler();
    $('#confirmDialog').close();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(button, false);
    app.confirmHandler = null;
  }
}

function closeAllDialogs() {
  $$('dialog[open]').forEach((dialog) => dialog.close());
  closeTaskMenu();
}

function closeTaskMenu() {
  $('#taskMenu').classList.remove('open');
  app.menuTaskId = null;
}

function openTaskMenu(taskId, x, y) {
  app.menuTaskId = taskId;
  const task = taskById(taskId);
  const completed = task?.status === 'completed';
  const editButton = $('[data-menu-action="edit"]', $('#taskMenu'));
  editButton.classList.toggle('hidden', completed);
  const menu = $('#taskMenu');
  menu.classList.add('open');
  const width = 140;
  const height = completed ? 48 : 86;
  menu.style.left = `${Math.min(window.innerWidth - width - 12, Math.max(12, x - width))}px`;
  menu.style.top = `${Math.min(window.innerHeight - height - 12, y + 5)}px`;
}

function shatterTaskCard(row, task) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return {
      collapsed: Promise.resolve(),
      reassemble: async () => {},
      dismiss: () => {}
    };
  }

  const rect = row.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'shatter-layer';
  document.body.append(layer);

  const colored = task.list_color || '#9DBFB2';
  const animations = [];
  const motionAnimations = [];
  const particles = [];
  const pieceCount = 150;
  const brightPalette = [
    '#fffdf8',
    '#fff0ae',
    '#d8f3e6',
    '#dce9ff',
    '#efdcff',
    '#ffd9cf',
    '#f2f8d7'
  ];

  for (let index = 0; index < pieceCount; index += 1) {
    const size = 7 + Math.random() * 13;
    const pieceWidth = size * (0.78 + Math.random() * 0.4);
    const pieceHeight = size * (0.7 + Math.random() * 0.45);
    const pieceLeft = rect.left + 3 + Math.random() * Math.max(1, rect.width - pieceWidth - 6);
    const pieceTop = rect.top + 2 + Math.random() * Math.max(1, rect.height - pieceHeight - 4);
    const vertices = 5 + Math.floor(Math.random() * 4);
    const points = [];
    for (let pointIndex = 0; pointIndex < vertices; pointIndex += 1) {
      const angle = pointIndex / vertices * Math.PI * 2 + Math.random() * .28;
      const radius = 30 + Math.random() * 20;
      const x = 50 + Math.cos(angle) * radius;
      const y = 50 + Math.sin(angle) * radius;
      points.push(`${x.toFixed(1)}% ${y.toFixed(1)}%`);
    }

    const piece = document.createElement('span');
    piece.className = 'shatter-piece';
    piece.style.left = `${pieceLeft}px`;
    piece.style.top = `${pieceTop}px`;
    piece.style.width = `${pieceWidth}px`;
    piece.style.height = `${pieceHeight}px`;
    piece.style.clipPath = `polygon(${points.join(', ')})`;
    piece.style.borderRadius = `${1 + Math.random() * 2}px`;
    piece.style.background = index % 13 === 0
      ? `linear-gradient(135deg, #fffdf8, color-mix(in srgb, ${colored} 38%, #ffffff))`
      : brightPalette[index % brightPalette.length];
    if (index % 11 === 0) {
      piece.style.boxShadow = '0 0 9px rgba(255, 241, 173, .82)';
    }
    layer.append(piece);
    particles.push(piece);

    const direction = (pieceLeft + pieceWidth / 2 - (rect.left + rect.width / 2)) * .54 +
      (Math.random() * 64 - 32);
    const lift = 14 + Math.random() * 34;
    const drift = 56 + Math.random() * 92;
    const fall = window.innerHeight - pieceTop + 70 + Math.random() * 110;
    const spin = Math.random() * 180 - 90;
    const motion = piece.animate(
      [
        {
          transform: 'translate3d(0, 0, 0) rotate(0deg) scale(1)',
          opacity: 1,
          easing: 'cubic-bezier(.18,.68,.28,1)'
        },
        {
          transform: `translate3d(${direction * .68}px, ${-lift}px, 0) rotate(${spin * .22}deg) scale(.98)`,
          opacity: 1,
          offset: .13,
          easing: 'cubic-bezier(.38,.08,.58,.72)'
        },
        {
          transform: `translate3d(${direction + drift * .18}px, ${fall * .12}px, 0) rotate(${spin * .46}deg) scale(.94)`,
          opacity: .92,
          offset: .3
        },
        {
          transform: `translate3d(${direction + drift}px, ${fall}px, 0) rotate(${spin}deg) scale(.82)`,
          opacity: 0
        }
      ],
      {
        duration: 1600 + Math.random() * 700,
        delay: 0,
        easing: 'linear',
        fill: 'forwards'
      }
    );
    motionAnimations.push(motion);
    animations.push(motion.finished);
  }

  row.style.pointerEvents = 'none';
  row.style.overflow = 'hidden';
  const collapse = row.animate(
    [
      {
        height: `${rect.height}px`,
        minHeight: '62px',
        paddingTop: '10px',
        paddingBottom: '10px',
        opacity: 1,
        transform: 'scale(1)'
      },
      {
        height: `${rect.height * .58}px`,
        minHeight: '0px',
        paddingTop: '4px',
        paddingBottom: '4px',
        opacity: .48,
        transform: 'scale(.98)',
        offset: .45
      },
      {
        height: '0px',
        minHeight: '0px',
        paddingTop: '0px',
        paddingBottom: '0px',
        borderWidth: '0px',
        opacity: 0,
        transform: 'scale(.95)'
      }
    ],
    { duration: 460, easing: 'cubic-bezier(.28,.02,.35,1)', fill: 'forwards' }
  ).finished;

  let removed = false;
  let reassembling = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    layer.remove();
  };
  Promise.allSettled(animations).then(() => {
    if (!reassembling) cleanup();
  });

  return {
    collapsed: collapse.then(() => undefined),
    dismiss: cleanup,
    reassemble: async (targetRow) => {
      if (!targetRow?.isConnected) {
        cleanup();
        return;
      }

      reassembling = true;
      const current = particles.map((piece) => {
        const bounds = piece.getBoundingClientRect();
        return { piece, bounds };
      });
      motionAnimations.forEach((motion) => motion.cancel());

      targetRow.style.opacity = '0';
      targetRow.style.transform = 'scale(.88)';
      const targetRect = targetRow.getBoundingClientRect();
      const movements = [];
      current.forEach(({ piece, bounds }, index) => {
        piece.style.left = `${bounds.left}px`;
        piece.style.top = `${bounds.top}px`;
        piece.style.width = `${bounds.width}px`;
        piece.style.height = `${bounds.height}px`;
        const targetLeft = targetRect.left + Math.random() * Math.max(1, targetRect.width - bounds.width);
        const targetTop = targetRect.top + Math.random() * Math.max(1, targetRect.height - bounds.height);
        movements.push(piece.animate(
          [
            {
              left: `${bounds.left}px`,
              top: `${bounds.top}px`,
              transform: 'rotate(0deg) scale(1)',
              opacity: 1
            },
            {
              left: `${targetLeft}px`,
              top: `${targetTop}px`,
              transform: `rotate(${Math.random() * 46 - 23}deg) scale(.92)`,
              opacity: 1
            },
            {
              left: `${targetLeft}px`,
              top: `${targetTop}px`,
              transform: 'rotate(0deg) scale(.45)',
              opacity: 0,
              offset: 1
            }
          ],
          {
            duration: 560 + Math.random() * 190,
            delay: (index % 14) * 9,
            easing: 'cubic-bezier(.18,.74,.24,1)',
            fill: 'forwards'
          }
        ).finished);
      });

      targetRow.animate(
        [
          { opacity: 0, transform: 'scale(.88)' },
          { opacity: 1, transform: 'scale(1.012)', offset: .78 },
          { opacity: 1, transform: 'scale(1)' }
        ],
        {
          duration: 340,
          delay: 430,
          easing: 'cubic-bezier(.2,.76,.24,1)',
          fill: 'forwards'
        }
      );

      await Promise.allSettled(movements);
      targetRow.style.opacity = '';
      targetRow.style.transform = '';
      cleanup();
    }
  };
}

function completeTaskCardMotion(row, task) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return Promise.resolve();
  }

  const rect = row.getBoundingClientRect();
  const check = $('.task-check', row);
  const checkIcon = check ? $('svg', check) : null;
  const title = $('.task-title', row);
  const accent = task.list_color || '#9DBFB2';
  const strike = document.createElement('span');
  strike.className = 'task-completion-strike';
  title?.append(strike);
  row.classList.add('completion-folding');

  const motions = [];
  if (check) {
    check.disabled = true;
    motions.push(check.animate(
      [
        {
          backgroundColor: 'rgba(0, 0, 0, 0)',
          borderColor: '#cbcac3',
          transform: 'scale(1)'
        },
        {
          backgroundColor: accent,
          borderColor: accent,
          transform: 'scale(1.13)',
          offset: .68
        },
        {
          backgroundColor: accent,
          borderColor: accent,
          transform: 'scale(1)'
        }
      ],
      {
        duration: 300,
        easing: 'cubic-bezier(.34,1.56,.64,1)',
        fill: 'forwards'
      }
    ).finished);
  }
  if (checkIcon) {
    motions.push(checkIcon.animate(
      [
        { color: 'transparent', opacity: 0, transform: 'scale(.55)' },
        { color: '#fffdf8', opacity: 1, transform: 'scale(1.08)', offset: .72 },
        { color: '#fffdf8', opacity: 1, transform: 'scale(1)' }
      ],
      {
        duration: 280,
        delay: 40,
        easing: 'cubic-bezier(.34,1.56,.64,1)',
        fill: 'forwards'
      }
    ).finished);
  }
  if (strike) {
    motions.push(strike.animate(
      [
        { transform: 'scaleX(0)', opacity: 0 },
        { transform: 'scaleX(1)', opacity: 1 }
      ],
      {
        duration: 360,
        delay: 150,
        easing: 'cubic-bezier(.2,.72,.24,1)',
        fill: 'forwards'
      }
    ).finished);
  }

  motions.push(row.animate(
    [
      {
        height: `${rect.height}px`,
        minHeight: '62px',
        paddingTop: '10px',
        paddingBottom: '10px',
        opacity: 1,
        transform: 'perspective(720px) rotateX(0deg) scaleY(1)'
      },
      {
        height: `${rect.height}px`,
        minHeight: '62px',
        paddingTop: '10px',
        paddingBottom: '10px',
        opacity: .92,
        transform: 'perspective(720px) rotateX(10deg) scaleY(.98)',
        offset: .22
      },
      {
        height: `${rect.height * .48}px`,
        minHeight: '0px',
        paddingTop: '3px',
        paddingBottom: '3px',
        opacity: .5,
        transform: 'perspective(720px) rotateX(52deg) scaleY(.42)',
        offset: .68
      },
      {
        height: '0px',
        minHeight: '0px',
        paddingTop: '0px',
        paddingBottom: '0px',
        borderWidth: '0px',
        opacity: 0,
        transform: 'perspective(720px) rotateX(86deg) scaleY(.04)'
      }
    ],
    {
      duration: 560,
      delay: 290,
      easing: 'cubic-bezier(.28,.02,.18,1)',
      fill: 'forwards'
    }
  ).finished);

  return Promise.allSettled(motions).then(() => undefined);
}

async function toggleTask(taskId) {
  const task = taskById(taskId);
  if (!task) return;
  if (task.status === 'completed') {
    if (!Number(task.can_restore)) {
      toast('原分表已删除，这件事不能恢复为未完成。', 'error');
      return;
    }
    try {
      const result = await api(`/api/tasks/${encodeURIComponent(taskId)}/restore`, { method: 'POST' });
      setState(result.state);
      toast('已经恢复到原分表。');
    } catch (error) {
      toast(error.message, 'error');
    }
    return;
  }
  const row = $(`.task-row[data-task-id="${CSS.escape(taskId)}"]`);
  const previousPending = Number($('#progressNumber').textContent);
  const completionMotion = row ? completeTaskCardMotion(row, task) : Promise.resolve();
  try {
    const [result] = await Promise.all([
      api(`/api/tasks/${encodeURIComponent(taskId)}/complete`, { method: 'POST' }),
      completionMotion
    ]);
    const positions = captureTaskPositions();
    setState(result.state);
    animatePendingCount(previousPending);
    animateTaskReflow(positions, new Set([taskId]));
    const completedRow = $(`.completed-row[data-task-id="${CSS.escape(taskId)}"]`);
    if (completedRow) {
      completedRow.animate(
        [
          { opacity: 0, transform: 'translateY(-7px) scale(.985)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' }
        ],
        { duration: 420, easing: 'cubic-bezier(.2,.72,.24,1)' }
      );
    }
    toast('完成一件，辛苦了。');
  } catch (error) {
    toast(error.message, 'error');
    renderView();
  }
}

function askDeleteTask(taskId) {
  const task = taskById(taskId);
  if (!task) return;
  openConfirm({
    title: '永久删除这件事？',
    description: `“${task.title}”删除后无法找回。`,
    action: async () => {
      const result = await api(`/api/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
      setState(result.state);
      toast('事项已永久删除。');
    }
  });
}

function selectView(view) {
  if (view !== 'total' && view !== 'overdue' && view !== 'completed') {
    if (!app.state.lists.some((list) => list.id === view)) return;
  }
  app.selected = view;
  closeTaskMenu();
  renderAll();
}

async function moveTaskToList(taskId, listId) {
  const task = taskById(taskId);
  const list = app.state.lists.find((item) => item.id === listId);
  if (!task || !list || task.list_id === listId) {
    renderView();
    return;
  }
  const positions = captureTaskPositions();
  try {
    const result = await api(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: { listId }
    });
    setState(result.state);
    animateTaskReflow(positions);
    toast(`已移到“${list.name}”。`);
  } catch (error) {
    toast(error.message, 'error');
    renderView();
  }
}

async function reorderTasks(taskId, targetId, after) {
  if (!taskId || !targetId || taskId === targetId) {
    renderView();
    return;
  }
  const task = taskById(taskId);
  const target = taskById(targetId);
  if (!task || !target || task.date !== target.date) {
    renderView();
    return;
  }
  const ids = sortByOrder(app.state.openTasks.filter((item) => item.date === task.date))
    .map((item) => item.id);
  const from = ids.indexOf(taskId);
  if (from < 0) {
    renderView();
    return;
  }
  ids.splice(from, 1);
  let targetIndex = ids.indexOf(targetId);
  if (targetIndex < 0) {
    renderView();
    return;
  }
  if (after) targetIndex += 1;
  ids.splice(targetIndex, 0, taskId);
  if (ids.every((id, index) => id === sortByOrder(app.state.openTasks.filter((item) => item.date === task.date))[index]?.id)) {
    renderView();
    return;
  }
  const positions = captureTaskPositions();
  try {
    const result = await api('/api/tasks/reorder', {
      method: 'POST',
      body: { taskIds: ids }
    });
    setState(result.state);
    animateTaskReflow(positions);
  } catch (error) {
    toast(error.message, 'error');
    renderView();
  }
}

function clearDropMarkers(except = null) {
  $$('.task-row.drop-before, .task-row.drop-after').forEach((row) => {
    if (row !== except) row.classList.remove('drop-before', 'drop-after');
  });
  $$('.list-tab.drag-over').forEach((tab) => tab.classList.remove('drag-over'));
}

function startPress(event, row) {
  if (event.button !== 0) return;
  const task = taskById(row.dataset.taskId);
  if (!task) return;
  app.press = {
    row,
    task,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    started: false,
    canceled: false,
    timer: null
  };
  app.press.timer = setTimeout(() => {
    if (!app.press || app.press.canceled) return;
    app.press.started = true;
    beginTaskDrag(app.press, event);
  }, HOLD_MS);
}

function beginTaskDrag(press, event) {
  const rect = press.row.getBoundingClientRect();
  const originalParent = press.row.parentElement;
  const originalNextSibling = press.row.nextSibling;
  const rowRects = new Map(
    $$('.task-row')
      .filter((row) => row.isConnected && row !== press.row)
      .map((row) => [row, row.getBoundingClientRect()])
  );
  app.drag = {
    ...press,
    originRect: {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    },
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    originalParent,
    originalNextSibling,
    targetId: null,
    targetRow: null,
    after: false,
    tabTarget: null,
    autoDestination: null,
    edgeDirection: 0,
    edgeAnchorX: null,
    edgeTimer: null
  };
  $('#dragLayer').append(press.row);
  press.row.classList.add('drag-lifted');
  press.row.style.left = `${rect.left}px`;
  press.row.style.top = `${rect.top}px`;
  press.row.style.width = `${rect.width}px`;
  press.row.style.height = `${rect.height}px`;
  document.body.style.cursor = 'grabbing';
  hideViewSwitchHint();
  setTaskTabProximity(false, press.row);
  const ghost = $('#dragGhost');
  if (ghost.parentElement !== $('#dragLayer')) $('#dragLayer').append(ghost);
  ghost.innerHTML = `<strong>${escapeHtml(press.task.title)}</strong><small>${escapeHtml(press.task.list_name)} · ${escapeHtml(tinyDateLabel(press.task.date))}</small>`;
  ghost.classList.add('hidden');
  moveLiftedCard(event.clientX, event.clientY);

  requestAnimationFrame(() => {
    const movingRows = [...rowRects.entries()]
      .sort((a, b) => a[1].top - b[1].top);
    for (const [index, [row, before]] of movingRows.entries()) {
      if (!row.isConnected) continue;
      const after = row.getBoundingClientRect();
      const distance = before.top - after.top;
      if (Math.abs(distance) < 1) continue;
      row.animate(
        [
          { transform: `translateY(${distance}px)` },
          { transform: 'translateY(0)' }
        ],
        {
          duration: 210,
          delay: Math.min(index * 18, 90),
          easing: 'cubic-bezier(.2,.75,.25,1)'
        }
      );
    }
  });
  if (navigator.vibrate) navigator.vibrate(8);
}

function restoreLiftedRow(drag) {
  const row = drag?.row;
  if (!row?.isConnected) return;
  row.classList.remove('drag-lifted');
  row.removeAttribute('style');
  const parent = drag.originalParent;
  if (!parent?.isConnected) {
    row.remove();
    renderView();
    return;
  }
  const next = drag.originalNextSibling?.parentNode === parent ? drag.originalNextSibling : null;
  parent.insertBefore(row, next);
}

function captureTaskPositions() {
  return new Map(
    $$('.task-row[data-task-id]')
      .filter((row) => row.isConnected && !row.classList.contains('drag-lifted'))
      .map((row) => [row.dataset.taskId, row.getBoundingClientRect()])
  );
}

function animateTaskReflow(positions, excludeTaskIds = new Set()) {
  requestAnimationFrame(() => {
    for (const row of $$('.task-row[data-task-id]')) {
      if (excludeTaskIds.has(row.dataset.taskId)) continue;
      const before = positions.get(row.dataset.taskId);
      if (!before || !row.isConnected) continue;
      const after = row.getBoundingClientRect();
      const deltaX = before.left - after.left;
      const deltaY = before.top - after.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) continue;
      row.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: 'translate(0, 0)' }
        ],
        {
          duration: 260,
          easing: 'cubic-bezier(.2,.72,.24,1)'
        }
      );
    }
  });
}

function moveLiftedCard(x, y) {
  const drag = app.drag;
  if (!drag?.row?.isConnected) return;
  drag.row.style.left = `${x - drag.offsetX}px`;
  drag.row.style.top = `${y - drag.offsetY}px`;
}

function moveGhost(x, y) {
  const ghost = $('#dragGhost');
  ghost.style.left = `${Math.max(10, Math.min(window.innerWidth - 310, x + 14))}px`;
  ghost.style.top = `${Math.max(10, Math.min(window.innerHeight - 80, y + 13))}px`;
}

function taskCanMoveList() {
  return Boolean(selectedUserList());
}

function setTaskTabProximity(nearTabs, row = app.drag?.row) {
  row?.classList.toggle('drag-over-tabs', nearTabs);
  $('.list-tabs-wrap')?.classList.toggle('task-drag-near', nearTabs);
}

function adjacentUserList(direction) {
  const lists = app.state.lists;
  if (lists.length < 2) return null;
  const currentIndex = lists.findIndex((list) => list.id === app.selected);
  if (currentIndex < 0) return null;
  return lists[(currentIndex + direction + lists.length) % lists.length];
}

function hideViewSwitchHint() {
  const hint = $('#viewSwitchHint');
  hint.classList.add('hidden');
  hint.classList.remove('forward', 'switched');
}

function cancelEdgeSwitch() {
  if (app.drag?.edgeTimer) clearTimeout(app.drag.edgeTimer);
  if (app.drag) {
    app.drag.edgeTimer = null;
    app.drag.edgeDirection = 0;
    app.drag.edgeAnchorX = null;
  }
  hideViewSwitchHint();
}

function showViewSwitchHint(list, direction, switched = false) {
  if (!list) return;
  const hint = $('#viewSwitchHint');
  const panelRect = $('.list-panel').getBoundingClientRect();
  hint.innerHTML = `<span class="switch-dot" style="--switch-color:${escapeHtml(list.color)}"></span>
    <span>${switched ? '已切换到' : '切换到'}“${escapeHtml(list.name)}”</span>`;
  hint.style.left = direction > 0
    ? `${Math.max(12, Math.min(window.innerWidth - 190, panelRect.right - 178))}px`
    : `${Math.max(12, panelRect.left + 18)}px`;
  hint.style.top = `${Math.max(12, panelRect.top + 18)}px`;
  hint.classList.remove('hidden');
  hint.classList.toggle('forward', direction > 0);
  hint.classList.toggle('switched', switched);
}

function animateViewContent(direction) {
  $('#taskContent').animate(
    [
      { opacity: .55, transform: `translateX(${direction * 18}px)` },
      { opacity: 1, transform: 'translateX(0)' }
    ],
    { duration: 280, easing: 'cubic-bezier(.2,.72,.24,1)' }
  );
  $('.list-panel').animate(
    [
      { boxShadow: '0 12px 40px rgba(67, 72, 60, .045)' },
      { boxShadow: `0 18px 48px rgba(82, 109, 96, ${direction > 0 ? '.13' : '.13'})`, offset: .45 },
      { boxShadow: '0 12px 40px rgba(67, 72, 60, .045)' }
    ],
    { duration: 500, easing: 'ease-out' }
  );
}

function performEdgeSwitch(direction, x) {
  if (!app.drag || app.drag.edgeDirection !== direction) return;
  const next = adjacentUserList(direction);
  if (!next) return;
  app.drag.edgeTimer = null;
  app.drag.autoDestination = next.id;
  app.drag.edgeAnchorX = x;
  selectView(next.id);
  animateViewContent(direction);
  showViewSwitchHint(next, direction, true);
}

function scheduleEdgeSwitch(direction, x) {
  if (!app.drag) return;
  if (app.drag.edgeTimer) clearTimeout(app.drag.edgeTimer);
  const next = adjacentUserList(direction);
  if (!next) return;
  showViewSwitchHint(next, direction, false);
  app.drag.edgeTimer = setTimeout(() => {
    performEdgeSwitch(direction, x);
  }, 420);
}

function handlePressMove(event) {
  if (app.press && !app.drag) {
    const distance = Math.hypot(event.clientX - app.press.startX, event.clientY - app.press.startY);
    if (distance > 6) {
      clearTimeout(app.press.timer);
      app.press.canceled = true;
      app.press = null;
    }
    return;
  }
  if (!app.drag) return;
  event.preventDefault();
  moveLiftedCard(event.clientX, event.clientY);
  moveGhost(event.clientX, event.clientY);
  const tabBarRect = $('.list-tabs-wrap').getBoundingClientRect();
  const nearTabs = event.clientY >= tabBarRect.top - 48 &&
    event.clientY <= tabBarRect.bottom + 24 &&
    event.clientX >= tabBarRect.left - 36 &&
    event.clientX <= tabBarRect.right + 36;
  setTaskTabProximity(nearTabs);
  clearDropMarkers();

  const under = document.elementFromPoint(event.clientX, event.clientY);
  const tab = under?.closest?.('.list-tab');
  if (tab) {
    const view = tab.dataset.view;
    if (taskCanMoveList() && view !== 'total' && view !== 'overdue' && view !== 'completed') {
      app.drag.targetId = null;
      app.drag.targetRow = null;
      app.drag.tabTarget = view === app.drag.task.list_id ? null : view;
      if (app.drag.tabTarget) tab.classList.add('drag-over');
      return;
    }
  }
  app.drag.tabTarget = null;

  const listPanel = $('.list-panel').getBoundingClientRect();
  const edgeDirection = event.clientX > listPanel.right + 18
    ? 1
    : event.clientX < listPanel.left - 18
      ? -1
      : 0;
  if (taskCanMoveList() && edgeDirection) {
    if (app.drag.edgeDirection !== edgeDirection) {
      app.drag.edgeDirection = edgeDirection;
      app.drag.edgeAnchorX = null;
    }
    const edgeDistance = app.drag.edgeAnchorX === null
      ? null
      : Math.abs(event.clientX - app.drag.edgeAnchorX);
    if (edgeDistance === null || edgeDistance >= 36) {
      app.drag.edgeAnchorX = event.clientX;
      scheduleEdgeSwitch(edgeDirection, event.clientX);
    }
  } else {
    cancelEdgeSwitch();
  }

  const row = under?.closest?.('.task-row[data-draggable="true"]');
  if (!row || row === app.drag.row || row.dataset.date !== app.drag.task.date) return;
  const rect = row.getBoundingClientRect();
  const after = event.clientY > rect.top + rect.height / 2;
  app.drag.targetId = row.dataset.taskId;
  app.drag.targetRow = row;
  app.drag.after = after;
  row.classList.add(after ? 'drop-after' : 'drop-before');
}

function finishPress(event) {
  if (app.press && !app.drag) {
    clearTimeout(app.press.timer);
    if (!app.press.canceled) openTaskDialog(app.press.task);
    app.press = null;
    return;
  }
  if (!app.drag) return;
  const drag = app.drag;
  $('#dragGhost').classList.add('hidden');
  setTaskTabProximity(false, drag.row);
  clearDropMarkers();
  cancelEdgeSwitch();
  document.body.style.cursor = '';
  app.drag = null;
  app.press = null;

  const action = () => {
    if (drag.tabTarget) {
      moveTaskToList(drag.task.id, drag.tabTarget);
    } else if (drag.autoDestination) {
      moveTaskToList(drag.task.id, drag.autoDestination);
    } else if (drag.targetId) {
      reorderTasks(drag.task.id, drag.targetId, drag.after);
    }
  };
  const hasAction = Boolean(drag.tabTarget || drag.autoDestination || drag.targetId);

  if (!hasAction) {
    drag.row?.remove();
    renderView();
    return;
  }

  if (!drag.row?.isConnected) {
    action();
    return;
  }

  const row = drag.row;
  let destination = drag.originRect;
  if (drag.targetRow?.isConnected) {
    const targetRect = drag.targetRow.getBoundingClientRect();
    destination = {
      left: targetRect.left,
      top: targetRect.top,
      width: targetRect.width,
      height: targetRect.height
    };
  } else if (drag.tabTarget) {
    const tab = $(`.list-tab[data-view="${CSS.escape(drag.tabTarget)}"]`);
    if (tab) {
      const tabRect = tab.getBoundingClientRect();
      destination = {
        left: tabRect.left,
        top: tabRect.top,
        width: Math.min(tabRect.width, drag.originRect.width),
        height: drag.originRect.height
      };
    }
  }

  const currentLeft = Number.parseFloat(row.style.left) || drag.originRect.left;
  const currentTop = Number.parseFloat(row.style.top) || drag.originRect.top;
  const currentWidth = Number.parseFloat(row.style.width) || drag.originRect.width;
  const currentHeight = Number.parseFloat(row.style.height) || drag.originRect.height;
  row.getAnimations().forEach((animation) => animation.cancel());
  const dropAnimation = row.animate(
    [
      {
        left: `${currentLeft}px`,
        top: `${currentTop}px`,
        width: `${currentWidth}px`,
        height: `${currentHeight}px`,
        transform: 'translateY(-2px) scale(1.025)',
        boxShadow: '0 24px 55px rgba(47, 61, 53, .2), 0 8px 18px rgba(47, 61, 53, .09)'
      },
      {
        left: `${destination.left}px`,
        top: `${destination.top + 3}px`,
        width: `${destination.width}px`,
        height: `${destination.height}px`,
        transform: 'translateY(2px) scale(.986)',
        boxShadow: '0 12px 26px rgba(47, 61, 53, .12), 0 4px 9px rgba(47, 61, 53, .06)',
        offset: .72
      },
      {
        left: `${destination.left}px`,
        top: `${destination.top}px`,
        width: `${destination.width}px`,
        height: `${destination.height}px`,
        transform: 'translateY(0) scale(1)',
        boxShadow: '0 3px 8px rgba(47, 61, 53, .04)'
      }
    ],
    {
      duration: 270,
      easing: 'cubic-bezier(.18,.72,.24,1)',
      fill: 'forwards'
    }
  );
  dropAnimation.finished.then(() => {
    if (hasAction && row.isConnected) {
      row.remove();
    } else if (row.isConnected) {
      restoreLiftedRow(drag);
    }
    if (hasAction) action();
  });
}

function moveLiftedTab(x, y) {
  const press = app.tabPress;
  if (!press?.active || !press.tab.isConnected) return;
  press.tab.style.left = `${x - press.offsetX}px`;
  press.tab.style.top = `${y - press.offsetY}px`;
}

function animateTabReflow(positions) {
  requestAnimationFrame(() => {
    for (const tab of $$('.list-tab[data-list-id]')) {
      const before = positions.get(tab.dataset.listId);
      if (!before || !tab.isConnected) continue;
      const after = tab.getBoundingClientRect();
      const deltaX = before.left - after.left;
      if (Math.abs(deltaX) < 1) continue;
      tab.animate(
        [
          { transform: `translateX(${deltaX}px)` },
          { transform: 'translateX(0)' }
        ],
        { duration: 210, easing: 'cubic-bezier(.2,.72,.24,1)' }
      );
    }
  });
}

function applyTabOrderPreview(order) {
  const tabs = $('#listTabs');
  const divider = $('.tab-divider', tabs);
  const positions = new Map(
    $$('.list-tab[data-list-id]', tabs)
      .map((tab) => [tab.dataset.listId, tab.getBoundingClientRect()])
  );
  for (const listId of order) {
    const tab = $(`.list-tab[data-list-id="${CSS.escape(listId)}"]`, tabs);
    if (tab) tabs.insertBefore(tab, divider);
  }
  animateTabReflow(positions);
}

function restoreLiftedTab(press) {
  const tab = press?.tab;
  if (!tab?.isConnected) return;
  const positions = new Map(
    $$('.list-tab[data-list-id]')
      .filter((item) => item !== tab)
      .map((item) => [item.dataset.listId, item.getBoundingClientRect()])
  );
  tab.classList.remove('tab-dragging');
  tab.removeAttribute('style');
  if (press.originalParent?.isConnected) {
    const next = press.originalNextSibling?.parentNode === press.originalParent
      ? press.originalNextSibling
      : null;
    press.originalParent.insertBefore(tab, next);
  } else {
    renderTabs();
    return;
  }
  animateTabReflow(positions);
}

function startTabPress(event, tab) {
  if (event.button !== 0) return;
  const rect = tab.getBoundingClientRect();
  app.tabPress = {
    tab,
    listId: tab.dataset.listId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    originRect: rect,
    originalParent: tab.parentElement,
    originalNextSibling: tab.nextSibling,
    armed: false,
    active: false,
    canceled: false,
    order: app.state.lists.map((list) => list.id),
    timer: null
  };
  app.tabPress.timer = setTimeout(() => {
    if (!app.tabPress || app.tabPress.canceled) return;
    app.tabPress.armed = true;
  }, HOLD_MS);
}

function handleTabMove(event) {
  if (!app.tabPress) return;
  const distance = Math.hypot(event.clientX - app.tabPress.startX, event.clientY - app.tabPress.startY);
  if (!app.tabPress.active) {
    if (!app.tabPress.armed) {
      if (distance > 6) {
        clearTimeout(app.tabPress.timer);
        app.tabPress.canceled = true;
        app.tabPress = null;
      }
      return;
    }
    if (distance <= 4) return;
    const positions = new Map(
      $$('.list-tab[data-list-id]')
        .filter((item) => item !== app.tabPress.tab)
        .map((item) => [item.dataset.listId, item.getBoundingClientRect()])
    );
    const press = app.tabPress;
    press.active = true;
    $('#dragLayer').append(press.tab);
    press.tab.classList.add('tab-dragging');
    press.tab.style.left = `${press.originRect.left}px`;
    press.tab.style.top = `${press.originRect.top}px`;
    press.tab.style.width = `${press.originRect.width}px`;
    press.tab.style.height = `${press.originRect.height}px`;
    document.body.style.cursor = 'grabbing';
    animateTabReflow(positions);
  }
  if (!app.tabPress.active) {
    return;
  }
  event.preventDefault();
  moveLiftedTab(event.clientX, event.clientY);
  const under = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.list-tab[data-list-id]');
  if (!under || under === app.tabPress.tab) return;
  const targetId = under.dataset.listId;
  const remaining = app.tabPress.order.filter((id) => id !== app.tabPress.listId);
  let targetIndex = remaining.indexOf(targetId);
  if (targetIndex < 0) return;
  const targetRect = under.getBoundingClientRect();
  if (event.clientX > targetRect.left + targetRect.width / 2) targetIndex += 1;
  const nextOrder = [...remaining];
  nextOrder.splice(targetIndex, 0, app.tabPress.listId);
  if (nextOrder.every((id, index) => id === app.tabPress.order[index])) return;
  app.tabPress.order = nextOrder;
  applyTabOrderPreview(nextOrder);
}

async function finishTabPress() {
  if (!app.tabPress) return;
  clearTimeout(app.tabPress.timer);
  const press = app.tabPress;
  app.tabPress = null;
  if (!press.active) return;
  document.body.style.cursor = '';
  app.ignoreNextClick = true;
  setTimeout(() => { app.ignoreNextClick = false; }, 0);

  const current = app.state.lists.map((list) => list.id);
  const changed = !press.order.every((id, index) => id === current[index]);
  if (!changed) {
    press.tab.remove();
    renderAll();
    return;
  }
  const userTabs = $$('.list-tab[data-list-id]').filter((tab) => tab !== press.tab && tab.isConnected);
  const targetIndex = press.order.indexOf(press.listId);
  const previous = userTabs[targetIndex - 1];
  const next = userTabs[targetIndex];
  let destination = press.originRect;
  if (previous || next) {
    const reference = previous || next;
    const referenceRect = reference.getBoundingClientRect();
    destination = {
      left: previous && next
        ? (previous.getBoundingClientRect().right + next.getBoundingClientRect().left) / 2 - press.originRect.width / 2
        : previous
          ? previous.getBoundingClientRect().right - press.originRect.width + 5
          : next.getBoundingClientRect().left,
      top: referenceRect.top,
      width: press.originRect.width,
      height: press.originRect.height
    };
  }

  press.tab.getAnimations().forEach((animation) => animation.cancel());
  const animation = press.tab.animate(
    [
      {
        transform: 'translateY(-2px) scale(1.035)',
        boxShadow: '0 18px 36px rgba(47, 61, 53, .2), 0 5px 12px rgba(47, 61, 53, .08)'
      },
      {
        left: `${destination.left}px`,
        top: `${destination.top + 3}px`,
        transform: 'translateY(2px) scale(.97)',
        boxShadow: '0 8px 18px rgba(47, 61, 53, .1)',
        offset: .72
      },
      {
        left: `${destination.left}px`,
        top: `${destination.top}px`,
        transform: 'translateY(0) scale(1)',
        boxShadow: '0 4px 10px rgba(47, 61, 53, .05)'
      }
    ],
    { duration: 220, easing: 'cubic-bezier(.18,.72,.24,1)', fill: 'forwards' }
  );

  animation.finished.then(async () => {
    if (!changed) {
      restoreLiftedTab(press);
      return;
    }
    press.tab.remove();
    try {
      const result = await api('/api/lists/reorder', {
        method: 'POST',
        body: { listIds: press.order }
      });
      setState(result.state);
      toast('分表顺序已更新。');
    } catch (error) {
      renderAll();
      toast(error.message, 'error');
    }
  });
}

async function logout() {
  stopFocusTicker();
  clearFocusStorage();
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } finally {
    showAuth();
  }
}

function bindEvents() {
  $$('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchAuthMode(tab.dataset.authTab));
  });

  $('#authForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#authSubmit');
    setBusy(button, true, '正在进入…');
    $('#authError').textContent = '';
    try {
      const payload = await api(`/api/auth/${app.authMode}`, {
        method: 'POST',
        body: {
          username: $('#authUsername').value,
          password: $('#authPassword').value
        }
      });
      showApp(payload.user, payload.state);
    } catch (error) {
      $('#authError').textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  });

  $('#homeButton').addEventListener('click', () => selectView('total'));
  $('#addTaskButton').addEventListener('click', () => openTaskDialog());
  $('#emptyAddButton').addEventListener('click', () => openTaskDialog());
  $('#newListButton').addEventListener('click', () => openListDialog());
  $('#listSettingsButton').addEventListener('click', () => {
    const list = selectedUserList();
    if (list) openListDialog(list);
  });

  $('#listTabs').addEventListener('click', (event) => {
    if (app.ignoreNextClick) return;
    const tab = event.target.closest('.list-tab');
    if (!tab) return;
    selectView(tab.dataset.view);
  });

  $('#listTabs').addEventListener('pointerdown', (event) => {
    const tab = event.target.closest('.list-tab[data-list-id]');
    if (tab && !event.target.closest('button[data-view]')?.disabled) startTabPress(event, tab);
  });

  document.addEventListener('pointermove', (event) => {
    handlePressMove(event);
    handleTabMove(event);
  }, { passive: false });

  document.addEventListener('pointerup', () => {
    finishPress();
    finishTabPress();
  });

  document.addEventListener('pointercancel', () => {
    clearTimeout(app.press?.timer);
    clearTimeout(app.tabPress?.timer);
    $('#dragGhost').classList.add('hidden');
    setTaskTabProximity(false, app.drag?.row);
    cancelEdgeSwitch();
    restoreLiftedRow(app.drag);
    restoreLiftedTab(app.tabPress);
    app.press = null;
    app.drag = null;
    app.tabPress = null;
    document.body.style.cursor = '';
    clearDropMarkers();
  });

  $('#taskContent').addEventListener('pointerdown', (event) => {
    const row = event.target.closest('.task-row');
    if (!row || row.dataset.draggable !== 'true' || event.button !== 0 || event.target.closest('button')) return;
    startPress(event, row);
  });

  $('#taskContent').addEventListener('click', (event) => {
    const focusButton = event.target.closest('[data-focus-task]');
    if (focusButton) {
      event.stopPropagation();
      const task = app.state.openTasks.find((item) => item.id === focusButton.dataset.focusTask);
      if (task) showFocusSetup(task);
      return;
    }
    const menuButton = event.target.closest('[data-task-menu]');
    if (menuButton) {
      event.stopPropagation();
      const rect = menuButton.getBoundingClientRect();
      openTaskMenu(menuButton.dataset.taskMenu, rect.right, rect.bottom);
      return;
    }
    const toggle = event.target.closest('[data-toggle-task]');
    if (toggle) {
      event.stopPropagation();
      toggleTask(toggle.dataset.toggleTask);
      return;
    }
    const restore = event.target.closest('[data-restore-task]');
    if (restore) {
      event.stopPropagation();
      toggleTask(restore.dataset.restoreTask);
    }
  });

  $('#taskMenu').addEventListener('click', (event) => {
    const button = event.target.closest('[data-menu-action]');
    if (!button || !app.menuTaskId) return;
    const id = app.menuTaskId;
    closeTaskMenu();
    if (button.dataset.menuAction === 'edit') {
      openTaskDialog(taskById(id));
    } else {
      askDeleteTask(id);
    }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('#taskMenu') && !event.target.closest('[data-task-menu]')) closeTaskMenu();
  });

  $('#userButton').addEventListener('click', (event) => {
    event.stopPropagation();
    const menu = $('#userMenu');
    const open = menu.classList.toggle('open');
    $('#userButton').setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.user-wrap')) {
      $('#userMenu').classList.remove('open');
      $('#userButton').setAttribute('aria-expanded', 'false');
    }
  });
  $('#logoutButton').addEventListener('click', logout);

  $('#taskForm').addEventListener('submit', submitTask);
  $('#listForm').addEventListener('submit', submitList);
  $('#deleteListForm').addEventListener('submit', submitDeleteList);
  $('#confirmForm').addEventListener('submit', submitConfirm);

  $('#focusPresets').addEventListener('click', (event) => {
    const button = event.target.closest('[data-focus-minutes]');
    if (!button) return;
    setFocusDurationFromMinutes(Number(button.dataset.focusMinutes));
  });
  ['focusMinutes', 'focusSeconds'].forEach((id) => {
    $(`#${id}`).addEventListener('input', () => {
      setFocusPresetSelection(null);
      $('#focusSetupError').textContent = '';
    });
  });
  $('#focusStartButton').addEventListener('click', startFocusCountdown);
  $('#focusPauseButton').addEventListener('click', toggleFocusPause);
  $('#focusModeButton').addEventListener('click', toggleFocusMode);
  $('#focusRestartButton').addEventListener('click', restartFocusSetup);
  $('#focusBackButton').addEventListener('click', requestExitFocus);
  $('#focusExitButton').addEventListener('click', requestExitFocus);
  $('#focusFinishedBackButton').addEventListener('click', () => hideFocusPage());
  $('#focusCompleteTaskButton').addEventListener('click', completeTaskFromFocus);

  $('#colorOptions').addEventListener('click', (event) => {
    const button = event.target.closest('[data-color]');
    if (!button) return;
    app.selectedColor = button.dataset.color;
    $$('.color-choice', $('#colorOptions')).forEach((item) => item.classList.toggle('selected', item === button));
  });

  $('#deleteListButton').addEventListener('click', openDeleteListDialog);
  $$('input[name="deleteMode"]').forEach((input) => {
    input.addEventListener('change', () => {
      $('#transferTargetField').classList.toggle('hidden', $('#deleteTransferChoice').checked === false);
    });
  });

  $$('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => $(`#${button.dataset.closeDialog}`).close());
  });
  $$('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
}

async function boot() {
  bindEvents();
  $('#topDate').textContent = relativeDateLabel(dateText(new Date()));
  try {
    const payload = await api('/api/auth/me');
    showApp(payload.user, payload.state);
  } catch {
    showAuth();
  }
}

boot();
