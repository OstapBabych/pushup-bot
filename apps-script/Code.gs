/**
 * 💪 Pushup Bot — Google Apps Script + Google Sheets.
 * Requests come from the Cloudflare Worker (Telegram webhook, Mini App API, cron).
 * Full setup guide: README.md in the repository.
 *
 * ⚠️ After ANY code change: Deploy → Manage deployments → ✏️ → Version: New version → Deploy.
 */

// ===================== CONFIG =====================
// Secrets are NOT stored in code. Set them in Apps Script:
//   ⚙️ Project Settings → Script Properties → Add script property
//     BOT_TOKEN         — token from @BotFather
//     WEBAPP_URL        — Worker URL, e.g. https://pushup-bot.<name>.workers.dev
//     ALLOWED_USER_IDS  — your Telegram id (comma-separated for several); empty = anyone
//     DEFAULT_TZ        — optional, defaults to Europe/London
//     SECRET            — optional: setup() generates one and prints it to the log
let CFG_ = null;
function cfg_() {
  if (CFG_) return CFG_;
  const p = PropertiesService.getScriptProperties();
  const g = function (k) { return String(p.getProperty(k) || '').trim(); };
  CFG_ = {
    token: g('BOT_TOKEN'),
    secret: g('SECRET'),
    appUrl: g('WEBAPP_URL').replace(/\/+$/, ''),
    allowed: g('ALLOWED_USER_IDS').split(',').map(function (x) { return x.trim(); }).filter(Boolean).map(Number),
    tz: g('DEFAULT_TZ') || 'Europe/London',
  };
  return CFG_;
}
// ==================================================

const GRACE_MIN = 15;   // a reminder late by more than this is not sent
const SNOOZE_MIN = 10;
const LANGS = ['en', 'uk'];

// ===================== TRANSLATIONS =====================
const I18N = {
  en: {
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    praise: ['Nice one 💪', 'Keep it up! 🔥', 'Counted ✅', 'Beast mode! 🦾', 'Less lazy, more strong 👊'],
    help:
      '<b>Commands</b>\n' +
      '/stats — your stats\n' +
      '/settings — current settings\n' +
      '/now — do a set now (extra reminder)\n' +
      '/add 25 — log a set manually (or just send a number)\n' +
      '/reps 20 — push-ups per reminder\n' +
      '/hours 9-21 — active hours (also 9:30-21:15)\n' +
      '/every 60 — interval in minutes\n' +
      '/days 12345 — days of the week (1=Mon … 7=Sun)\n' +
      '/tz Europe/London — time zone\n' +
      '/lang uk — мова: українська\n' +
      '/pause, /resume — pause / resume reminders',
    commands: [['stats', 'Stats'], ['settings', 'Settings'], ['now', 'Do a set now'], ['add', 'Log a set manually'],
      ['lang', 'Language / Мова'], ['pause', 'Pause reminders'], ['resume', 'Resume reminders'], ['help', 'Help']],
    hello: 'Hi! I\'ll remind you to do push-ups 💪',
    changeHint: 'You can change everything in the Mini App or with commands.',
    menuButton: '📊 Stats',
    btnSettingsStats: '⚙️ Settings & stats', btnOpenStats: '📊 Open stats', btnChangeInApp: '⚙️ Change in the app', btnCharts: '📈 Charts',
    btnDone: function (n) { return '✅ Done ' + n; }, btnCustom: '✏️ Other amount',
    btnSnooze: function (m) { return '⏰ +' + m + ' min'; }, btnSkip: '❌ Skip',
    remind: '💪 <b>Push-up time!</b>', remindAgain: '⏰ <b>Reminder again!</b>',
    pushups: 'push-ups', today: 'Today',
    doneMsg: function (n) { return '✅ <b>Done: ' + n + '</b>'; },
    streakShort: function (n) { return ' · 🔥 ' + n + (n === 1 ? ' day' : ' days'); },
    skipped: '❌ Skipped', missed: '😴 No answer',
    settingsTitle: '⚙️ <b>Settings</b>',
    perSet: function (n) { return n + ' push-ups per reminder'; },
    schedule: function (a, b, i, n) { return 'from ' + a + ' to ' + b + ', every ' + i + ' min (' + n + ' times a day)'; },
    daysL: 'days', tzL: 'time zone', langL: 'language', langName: 'English', remindersL: 'reminders',
    on: '🟢 on', off: '⏸ paused', next: 'Next',
    statsTitle: '📊 <b>Stats</b>', week: 'Week', month: 'Month', total: 'Total',
    streak: function (a, b) { return '🔥 Streak: <b>' + a + '</b> ' + (a === 1 ? 'day' : 'days') + ' (best ' + b + ')'; },
    rate: function (p) { return '🎯 Reminders completed (30 days): <b>' + p + '%</b>'; },
    bestDay: function (d, n) { return '🏆 Best day: ' + d + ' — ' + n; },
    dateShort: function (ymd) { return ymd.slice(8, 10) + '/' + ymd.slice(5, 7); },
    saved: 'Saved ✅',
    logged: function (n, a, b) { return '✅ Logged ' + n + '. Today: ' + a + '/' + b; },
    range1000: 'The number must be between 1 and 1000', setNotFound: 'Couldn\'t find that set 🤔',
    notUnderstood: 'Didn\'t get that 🤔 Send a number to log a set, or /help', unknownCmd: 'Unknown command 🤔',
    noAccess: 'Access denied', notFound: 'Not found', already: 'Already recorded',
    askCount: 'How many push-ups did you do? Send a number 👇', askPh: 'e.g. 25',
    skipOk: 'Okay, next time 💪', snoozeOk: function (m) { return 'I\'ll remind you in ' + m + ' min'; },
    snoozedUntil: function (t) { return '⏰ I\'ll remind you at ' + t; },
    ex: {
      add: 'Example: <code>/add 25</code>', reps: 'Example: <code>/reps 20</code>',
      every: 'Example: <code>/every 60</code> (minutes)', hours: 'Example: <code>/hours 9-21</code> or <code>/hours 9:30-21:15</code>',
      days: 'Example: <code>/days 12345</code> — weekdays (1=Mon … 7=Sun)', tz: 'Example: <code>/tz Europe/London</code>',
      lang: 'Choose a language: <code>/lang en</code> or <code>/lang uk</code>',
    },
    errInt: function (l) { return l + ': must be a whole number'; },
    errRange: function (l, a, b) { return l + ': from ' + a + ' to ' + b; },
    lblReps: 'Push-ups', lblInterval: 'Interval (min)',
    errTime: 'Time must be HH:MM, e.g. 09:00', errDays: 'Days: digits 1–7 (1 = Mon, 7 = Sun), at least one day',
    errTz: function (tz) { return 'Unknown time zone: ' + tz; }, errOrder: 'Start must be earlier than end',
    errLang: 'Language: en or uk', errServer: 'Server error',
    todayW: 'today', tomorrowW: 'tomorrow', at: 'at',
    langSet: 'Language set to English 🇬🇧',
  },
  uk: {
    days: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'],
    praise: ['Красава 💪', 'Так тримати! 🔥', 'Зараховано ✅', 'Машина! 🦾', 'Мінус лінь, плюс сила 👊'],
    help:
      '<b>Команди</b>\n' +
      '/stats — статистика\n' +
      '/settings — поточні налаштування\n' +
      '/now — віджатися зараз (позачергове нагадування)\n' +
      '/add 25 — записати підхід вручну (або просто надішли число)\n' +
      '/reps 20 — віджимань за раз\n' +
      '/hours 9-21 — проміжок часу (можна 9:30-21:15)\n' +
      '/every 60 — інтервал у хвилинах\n' +
      '/days 12345 — дні тижня (1=Пн … 7=Нд)\n' +
      '/tz Europe/Kyiv — часовий пояс\n' +
      '/lang en — language: English\n' +
      '/pause, /resume — пауза / відновити',
    commands: [['stats', 'Статистика'], ['settings', 'Налаштування'], ['now', 'Віджатися зараз'], ['add', 'Записати підхід вручну'],
      ['lang', 'Мова / Language'], ['pause', 'Пауза'], ['resume', 'Відновити'], ['help', 'Допомога']],
    hello: 'Привіт! Я нагадуватиму тобі віджиматися 💪',
    changeHint: 'Змінити все можна в міні-аппі або командами.',
    menuButton: '📊 Статистика',
    btnSettingsStats: '⚙️ Налаштування і статистика', btnOpenStats: '📊 Відкрити статистику', btnChangeInApp: '⚙️ Змінити в міні-аппі', btnCharts: '📈 Графіки',
    btnDone: function (n) { return '✅ Зробив ' + n; }, btnCustom: '✏️ Інша к-сть',
    btnSnooze: function (m) { return '⏰ +' + m + ' хв'; }, btnSkip: '❌ Пропустити',
    remind: '💪 <b>Час віджиматися!</b>', remindAgain: '⏰ <b>Нагадую ще раз!</b>',
    pushups: 'віджимань', today: 'Сьогодні',
    doneMsg: function (n) { return '✅ <b>Зроблено: ' + n + '</b>'; },
    streakShort: function (n) { return ' · 🔥 ' + n + ' дн.'; },
    skipped: '❌ Пропущено', missed: '😴 Без відповіді',
    settingsTitle: '⚙️ <b>Налаштування</b>',
    perSet: function (n) { return n + ' віджимань за раз'; },
    schedule: function (a, b, i, n) { return 'з ' + a + ' до ' + b + ', кожні ' + i + ' хв (' + n + ' разів/день)'; },
    daysL: 'дні', tzL: 'часовий пояс', langL: 'мова', langName: 'українська', remindersL: 'нагадування',
    on: '🟢 увімкнені', off: '⏸ на паузі', next: 'Наступне',
    statsTitle: '📊 <b>Статистика</b>', week: 'Тиждень', month: 'Місяць', total: 'Всього',
    streak: function (a, b) { return '🔥 Серія: <b>' + a + '</b> дн. (рекорд ' + b + ')'; },
    rate: function (p) { return '🎯 Виконано нагадувань за 30 днів: <b>' + p + '%</b>'; },
    bestDay: function (d, n) { return '🏆 Найкращий день: ' + d + ' — ' + n; },
    dateShort: function (ymd) { return ymd.slice(8, 10) + '.' + ymd.slice(5, 7); },
    saved: 'Збережено ✅',
    logged: function (n, a, b) { return '✅ Записав ' + n + '. Сьогодні: ' + a + '/' + b; },
    range1000: 'Число має бути від 1 до 1000', setNotFound: 'Не знайшов цей підхід 🤔',
    notUnderstood: 'Не зрозумів 🤔 Надішли число, щоб записати підхід, або /help', unknownCmd: 'Невідома команда 🤔',
    noAccess: 'Немає доступу', notFound: 'Не знайдено', already: 'Вже відмічено',
    askCount: 'Скільки віджимань зробив? Надішли число 👇', askPh: 'напр. 25',
    skipOk: 'Окей, наступного разу 💪', snoozeOk: function (m) { return 'Нагадаю через ' + m + ' хв'; },
    snoozedUntil: function (t) { return '⏰ Нагадаю о ' + t; },
    ex: {
      add: 'Приклад: <code>/add 25</code>', reps: 'Приклад: <code>/reps 20</code>',
      every: 'Приклад: <code>/every 60</code> (хвилин)', hours: 'Приклад: <code>/hours 9-21</code> або <code>/hours 9:30-21:15</code>',
      days: 'Приклад: <code>/days 12345</code> — будні (1=Пн … 7=Нд)', tz: 'Приклад: <code>/tz Europe/Kyiv</code>',
      lang: 'Обери мову: <code>/lang uk</code> або <code>/lang en</code>',
    },
    errInt: function (l) { return l + ': потрібне ціле число'; },
    errRange: function (l, a, b) { return l + ': від ' + a + ' до ' + b; },
    lblReps: 'Кількість віджимань', lblInterval: 'Інтервал (хв)',
    errTime: 'Час має бути у форматі ГГ:ХХ, напр. 09:00', errDays: 'Дні: цифри 1–7 (1 = Пн, 7 = Нд), хоча б один день',
    errTz: function (tz) { return 'Невідомий часовий пояс: ' + tz; }, errOrder: 'Початок має бути раніше за кінець',
    errLang: 'Мова: en або uk', errServer: 'Помилка сервера',
    todayW: 'сьогодні', tomorrowW: 'завтра', at: 'о',
    langSet: 'Мову змінено на українську 🇺🇦',
  },
};

/** Translations for a user (falls back to English). */
function L_(u) { return I18N[u && u.lang] || I18N.en; }

/** Telegram language_code → our language. */
function langFrom_(code) { return /^uk/i.test(code || '') ? 'uk' : 'en'; }

class UserError extends Error {}

// ===================== ENTRY POINT =====================
function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (_) { return out_({ status: 400, body: { detail: 'bad json' } }); }
  if (!cfg_().secret || req.secret !== cfg_().secret) return out_({ status: 403, body: { detail: 'forbidden' } });

  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (req.kind === 'update') {
      const cache = CacheService.getScriptCache();
      const key = 'u' + req.update.update_id;
      if (cache.get(key)) return out_({ status: 200, body: { dup: true } });
      cache.put(key, '1', 21600);
      handleUpdate_(req.update);
      return out_({ status: 200, body: { ok: true } });
    }
    if (req.kind === 'tick') { tick_(); return out_({ status: 200, body: { ok: true } }); }
    if (req.kind === 'api') return out_(handleApi_(Number(req.uid), req.method, req.path, req.body, req.lang));
    return out_({ status: 400, body: { detail: 'unknown kind' } });
  } catch (err) {
    console.error(err && err.stack || err);
    return out_({ status: 500, body: { detail: 'Server error: ' + (err && err.message) } });
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function doGet() {
  return ContentService.createTextOutput('Pushup bot is alive 💪');
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ===================== ONE-TIME SETUP =====================
function setup() {
  const ss = SpreadsheetApp.getActive();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  ensureSheet_('Users', USER_COLS);
  ensureSheet_('Sets', SET_COLS);

  const props = PropertiesService.getScriptProperties();
  const missing = ['BOT_TOKEN', 'WEBAPP_URL'].filter(function (k) { return !props.getProperty(k); });
  if (missing.length) throw new Error('Add these in Project Settings → Script Properties: ' + missing.join(', '));
  if (!props.getProperty('SECRET')) {
    props.setProperty('SECRET', Utilities.getUuid().replace(/-/g, ''));
    CFG_ = null;
  }
  console.log('🔑 SECRET (put it into the Cloudflare Worker as the SECRET variable): ' + cfg_().secret);

  const wh = tg_('setWebhook', {
    url: cfg_().appUrl + '/tg', secret_token: cfg_().secret,
    allowed_updates: ['message', 'callback_query'], drop_pending_updates: true,
  });
  // Command menu: English by default, Ukrainian for Ukrainian-language Telegram clients
  LANGS.forEach(function (lang) {
    const p = { commands: I18N[lang].commands.map(function (c) { return { command: c[0], description: c[1] }; }) };
    if (lang !== 'en') p.language_code = lang;
    tg_('setMyCommands', p);
  });
  tg_('setChatMenuButton', { menu_button: menuButton_(I18N.en) });
  console.log('setWebhook: ' + JSON.stringify(wh));
  console.log('getWebhookInfo: ' + JSON.stringify(tg_('getWebhookInfo', {})));
  console.log(wh.ok ? '✅ Done! Send /start to your bot' : '❌ Webhook was not set — check WEBAPP_URL and BOT_TOKEN');
}

/** For debugging: prints the webhook status. */
function webhookInfo() {
  console.log(JSON.stringify(tg_('getWebhookInfo', {}), null, 2));
}

// ===================== SHEET (DATABASE) =====================
const USER_COLS = ['chat_id', 'reps', 'start_time', 'end_time', 'interval_min', 'days', 'tz', 'enabled', 'last_slot', 'created_at', 'lang'];
const SET_COLS = ['id', 'chat_id', 'local_time', 'planned', 'done', 'status', 'source', 'scheduled_at', 'message_id', 'sent_at', 'snooze_until', 'answered_at'];
const NUM_COLS = { chat_id: 1, reps: 1, interval_min: 1, enabled: 1, id: 1, planned: 1, done: 1, message_id: 1 };
const TABLES_ = {};

function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
}

function ensureSheet_(name, cols) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function toCell_(col, v) {
  if (v === null || v === undefined || v === '') return '';
  if (NUM_COLS[col]) return Number(v);
  return "'" + String(v); // leading apostrophe = keep as text (so Sheets doesn't turn it into a date)
}

function fromCell_(col, v) {
  if (NUM_COLS[col]) return v === '' || v === null || v === undefined ? null : Number(v);
  if (v instanceof Date) return v.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return v === null || v === undefined ? '' : String(v);
}

function table_(name) {
  if (TABLES_[name]) return TABLES_[name];
  const cols = name === 'Users' ? USER_COLS : SET_COLS;
  const sh = ss_().getSheetByName(name);
  const values = sh.getDataRange().getValues();
  // Columns added in newer versions (e.g. "lang") get their header automatically
  if (!values.length || values[0].length < cols.length || values[0][cols.length - 1] !== cols[cols.length - 1]) {
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
  }
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === '' || values[i][0] === null) continue;
    const o = { _row: i + 1 };
    cols.forEach(function (c, j) { o[c] = fromCell_(c, values[i][j]); });
    rows.push(o);
  }
  TABLES_[name] = { sh: sh, cols: cols, rows: rows };
  return TABLES_[name];
}

function writeRow_(t, o) {
  t.sh.getRange(o._row, 1, 1, t.cols.length).setValues([t.cols.map(function (c) { return toCell_(c, o[c]); })]);
}

function appendRow_(t, o) {
  t.sh.appendRow(t.cols.map(function (c) { return toCell_(c, o[c]); }));
  o._row = t.sh.getLastRow();
  t.rows.push(o);
  return o;
}

function getUser_(chatId) {
  return table_('Users').rows.filter(function (u) { return u.chat_id === chatId; })[0] || null;
}

function updateUser_(chatId, fields) {
  const t = table_('Users');
  const u = getUser_(chatId);
  Object.keys(fields).forEach(function (k) { u[k] = fields[k]; });
  writeRow_(t, u);
  return u;
}

function allSets_() { return table_('Sets').rows; }

function getSet_(id) {
  return allSets_().filter(function (s) { return s.id === Number(id); })[0] || null;
}

function addSet_(user, when, planned, opts) {
  opts = opts || {};
  const t = table_('Sets');
  const maxId = t.rows.reduce(function (m, s) { return Math.max(m, s.id || 0); }, 0);
  const status = opts.status || 'pending';
  return appendRow_(t, {
    id: maxId + 1, chat_id: user.chat_id,
    local_time: Utilities.formatDate(when, user.tz, 'yyyy-MM-dd HH:mm'),
    planned: planned, done: opts.done || 0, status: status, source: opts.source || 'reminder',
    scheduled_at: isoUtc_(when), message_id: null, sent_at: '', snooze_until: '',
    answered_at: status === 'pending' ? '' : isoUtc_(new Date()),
  });
}

function updateSet_(id, fields) {
  const s = getSet_(id);
  Object.keys(fields).forEach(function (k) { s[k] = fields[k]; });
  writeRow_(table_('Sets'), s);
  return s;
}

function deleteSet_(id) {
  const t = table_('Sets');
  const s = getSet_(id);
  t.sh.deleteRow(s._row);
  t.rows = t.rows.filter(function (r) { return r !== s; });
  t.rows.forEach(function (r) { if (r._row > s._row) r._row--; });
}

// ===================== TIME & SCHEDULE =====================
function isoUtc_(d) { return Utilities.formatDate(d, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'"); }
function ymd_(d, tz) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); }
function hm_(d, tz) { return Utilities.formatDate(d, tz, 'HH:mm'); }

function tzOffsetMin_(d, tz) {
  const z = Utilities.formatDate(d, tz, 'Z'); // +0100
  const sign = z.charAt(0) === '-' ? -1 : 1;
  return sign * (Number(z.substr(1, 2)) * 60 + Number(z.substr(3, 2)));
}

function ymdAdd_(ymd, n) {
  const p = ymd.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}

function ymdDow_(ymd) { // 1=Mon … 7=Sun
  const p = ymd.split('-').map(Number);
  return (new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() + 6) % 7 + 1;
}

function ymdDiff_(a, b) { return Math.round((Date.parse(a) - Date.parse(b)) / 86400000); }

/** Local wall-clock time (date + "HH:mm" in tz) → Date. */
function localDate_(ymd, hm, tz) {
  const p = ymd.split('-').map(Number);
  const t = hm.split(':').map(Number);
  const base = Date.UTC(p[0], p[1] - 1, p[2], t[0], t[1]);
  const guess = base - tzOffsetMin_(new Date(base), tz) * 60000;
  return new Date(base - tzOffsetMin_(new Date(guess), tz) * 60000);
}

function slotsOn_(u, ymd) {
  if (String(u.days).indexOf(String(ymdDow_(ymd))) < 0) return [];
  const start = localDate_(ymd, u.start_time, u.tz).getTime();
  const end = localDate_(ymd, u.end_time, u.tz).getTime();
  const out = [];
  for (let t = start; t <= end; t += u.interval_min * 60000) out.push(new Date(t));
  return out;
}

function dueSlot_(u, now) {
  const past = slotsOn_(u, ymd_(now, u.tz)).filter(function (s) { return s <= now; });
  if (!past.length) return null;
  const last = past[past.length - 1];
  return now - last <= GRACE_MIN * 60000 ? last : null;
}

function nextSlot_(u, now) {
  const today = ymd_(now, u.tz);
  for (let i = 0; i < 8; i++) {
    const s = slotsOn_(u, ymdAdd_(today, i)).filter(function (x) { return x > now; });
    if (s.length) return s[0];
  }
  return null;
}

function dailyGoal_(u, ymd) { return slotsOn_(u, ymd).length * u.reps; }

function whenLabel_(d, u, now) {
  const L = L_(u);
  const today = ymd_(now, u.tz), day = ymd_(d, u.tz);
  const prefix = day === today ? L.todayW : day === ymdAdd_(today, 1) ? L.tomorrowW : L.dateShort(day);
  return prefix + ' ' + L.at + ' ' + hm_(d, u.tz);
}

// ===================== USERS & SETTINGS =====================
/** Finds or creates the user. langCode = Telegram language_code (used for a new user or one without a language yet). */
function ensureUser_(chatId, langCode) {
  let u = getUser_(chatId);
  if (u) {
    if (!u.lang && langCode) u = updateUser_(chatId, { lang: langFrom_(langCode) });
    return { user: u, created: false };
  }
  u = appendRow_(table_('Users'), {
    chat_id: chatId, reps: 15, start_time: '09:00', end_time: '21:00', interval_min: 60,
    days: '1234567', tz: cfg_().tz, enabled: 1, last_slot: '', created_at: isoUtc_(new Date()), lang: langFrom_(langCode),
  });
  const due = dueSlot_(u, new Date());
  if (due) updateUser_(chatId, { last_slot: isoUtc_(due) }); // don't send a reminder right after signing up
  return { user: u, created: true };
}

function hmParse_(s, L) {
  const m = String(s).trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) throw new UserError(L.errTime);
  return ('0' + Number(m[1])).slice(-2) + ':' + m[2];
}

function validTz_(tz) {
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){0,2}$/.test(tz)) return false;
  if (tz === 'UTC' || tz === 'GMT') return true;
  // Java silently turns an unknown zone into GMT — catch that
  return Utilities.formatDate(new Date(), tz, 'zzzz') !== 'Greenwich Mean Time' ||
    /London|Dublin|Lisbon|Reykjavik|Abidjan|Accra|Dakar|Guernsey|Jersey|Isle_of_Man|Belfast/.test(tz);
}

function validate_(data, u) {
  const out = {};
  // Error messages use the new language if it is being changed in the same request
  const L = I18N[data.lang] || L_(u);
  function num(key, lo, hi, label) {
    const v = Number(data[key]);
    if (!isFinite(v) || String(data[key]).trim() === '' || Math.floor(v) !== v) throw new UserError(L.errInt(label));
    if (v < lo || v > hi) throw new UserError(L.errRange(label, lo, hi));
    return v;
  }
  if ('reps' in data) out.reps = num('reps', 1, 1000, L.lblReps);
  if ('interval_min' in data) out.interval_min = num('interval_min', 5, 720, L.lblInterval);
  if ('start_time' in data) out.start_time = hmParse_(data.start_time, L);
  if ('end_time' in data) out.end_time = hmParse_(data.end_time, L);
  if ('days' in data) {
    const d = String(data.days).split('').filter(function (c, i, a) { return a.indexOf(c) === i; }).sort().join('');
    if (!d || /[^1-7]/.test(d)) throw new UserError(L.errDays);
    out.days = d;
  }
  if ('tz' in data) {
    if (!validTz_(String(data.tz))) throw new UserError(L.errTz(data.tz));
    out.tz = String(data.tz);
  }
  if ('lang' in data) {
    if (LANGS.indexOf(String(data.lang)) < 0) throw new UserError(L.errLang);
    out.lang = String(data.lang);
  }
  if ('enabled' in data) out.enabled = data.enabled ? 1 : 0;
  const merged = Object.assign({}, u, out);
  if (merged.start_time >= merged.end_time) throw new UserError(L.errOrder);
  return out;
}

function saveSettings_(chatId, data) {
  const u = ensureUser_(chatId).user;
  const changes = validate_(data, u);
  const due = dueSlot_(Object.assign({}, u, changes), new Date());
  if (due) changes.last_slot = isoUtc_(due); // so a "late" reminder doesn't fire right after the change
  const langChanged = changes.lang && changes.lang !== u.lang;
  const nu = updateUser_(chatId, changes);
  if (langChanged) tg_('setChatMenuButton', { chat_id: chatId, menu_button: menuButton_(L_(nu)) });
  return nu;
}

// ===================== STATS =====================
function computeStats_(u, now) {
  const today = ymd_(now, u.tz);
  const since = isoUtc_(new Date(now.getTime() - 400 * 86400000));
  const days = {}, hourly = [], todaySets = { done: 0, skipped: 0, missed: 0, pending: 0 }, ans = { done: 0, skipped: 0, missed: 0 };
  for (let h = 0; h < 24; h++) hourly.push(0);
  let total = 0;

  allSets_().forEach(function (s) {
    if (s.chat_id !== u.chat_id) return;
    total += s.done || 0;
    if (s.scheduled_at < since) return;
    const lt = s.local_time || Utilities.formatDate(new Date(s.scheduled_at), u.tz, 'yyyy-MM-dd HH:mm');
    const d = lt.slice(0, 10), hour = Number(lt.slice(11, 13));
    days[d] = (days[d] || 0) + (s.done || 0);
    if (ymdDiff_(today, d) < 30) {
      hourly[hour] += s.done || 0;
      if (s.source === 'reminder' && s.status !== 'pending') ans[s.status] = (ans[s.status] || 0) + 1;
    }
    if (d === today) todaySets[s.status] = (todaySets[s.status] || 0) + 1;
  });

  const get = function (d) { return days[d] || 0; };
  const last = function (n) { let x = 0; for (let i = 0; i < n; i++) x += get(ymdAdd_(today, -i)); return x; };

  let d = get(today) > 0 ? today : ymdAdd_(today, -1), streak = 0;
  while (get(d) > 0) { streak++; d = ymdAdd_(d, -1); }

  let best = 0, run = 0, prev = null, bestDay = null;
  Object.keys(days).filter(function (k) { return days[k] > 0; }).sort().forEach(function (k) {
    run = prev && ymdDiff_(k, prev) === 1 ? run + 1 : 1;
    best = Math.max(best, run); prev = k;
    if (!bestDay || days[k] > bestDay.done) bestDay = { date: k, done: days[k] };
  });

  const series = [];
  for (let i = 29; i >= 0; i--) { const k = ymdAdd_(today, -i); series.push({ date: k, done: get(k), goal: dailyGoal_(u, k) }); }
  const start = ymdAdd_(today, -(ymdDow_(today) - 1) - 7 * 17);
  const heatmap = [];
  for (let k = start; k <= today; k = ymdAdd_(k, 1)) heatmap.push({ date: k, done: get(k) });

  const answered = ans.done + ans.skipped + ans.missed;
  const nxt = u.enabled ? nextSlot_(u, now) : null;
  return {
    today: { date: today, done: get(today), goal: dailyGoal_(u, today), sets: todaySets },
    week: last(7), month: last(30), total: total,
    streak: streak, best_streak: best,
    completion_rate: answered ? Math.round(100 * ans.done / answered) : null,
    best_day: bestDay,
    next_reminder: nxt ? whenLabel_(nxt, u, now) : null,
    series: series, heatmap: heatmap, hourly: hourly,
  };
}

// ===================== TELEGRAM =====================
function tg_(method, params) {
  const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + cfg_().token + '/' + method, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(params || {}), muteHttpExceptions: true,
  });
  let j;
  try { j = JSON.parse(r.getContentText()); } catch (_) { j = { ok: false, description: r.getContentText() }; }
  if (!j.ok) console.warn(method + ': ' + j.description);
  return j;
}

function send_(chatId, text, kb) {
  const p = { chat_id: chatId, text: text, parse_mode: 'HTML' };
  if (kb) p.reply_markup = kb;
  return tg_('sendMessage', p);
}

function edit_(chatId, messageId, text, kb) {
  const p = { chat_id: chatId, message_id: messageId, text: text, parse_mode: 'HTML' };
  if (kb) p.reply_markup = kb;
  return tg_('editMessageText', p);
}

function allowed_(id) { const a = cfg_().allowed; return !a.length || a.indexOf(Number(id)) >= 0; }

function menuButton_(L) { return { type: 'web_app', text: L.menuButton, web_app: { url: cfg_().appUrl } }; }

function webappKb_(text) {
  return { inline_keyboard: [[{ text: text, web_app: { url: cfg_().appUrl } }]] };
}

function reminderKb_(s, L) {
  return { inline_keyboard: [
    [{ text: L.btnDone(s.planned), callback_data: 'done:' + s.id }, { text: L.btnCustom, callback_data: 'custom:' + s.id }],
    [{ text: L.btnSnooze(SNOOZE_MIN), callback_data: 'snooze:' + s.id }, { text: L.btnSkip, callback_data: 'skip:' + s.id }],
  ] };
}

function hhmm_(iso, u) { return hm_(new Date(iso), u.tz); }

function reminderText_(u, s, again) {
  const L = L_(u), st = computeStats_(u, new Date());
  return (again ? L.remindAgain : L.remind) +
    '\n\n<b>' + s.planned + '</b> ' + L.pushups + ' · ' + hhmm_(s.scheduled_at, u) +
    '\n' + L.today + ': ' + st.today.done + '/' + st.today.goal;
}

function resultText_(u, s) {
  const L = L_(u), t = hhmm_(s.scheduled_at, u);
  if (s.status === 'done') {
    const st = computeStats_(u, new Date());
    return L.doneMsg(s.done) + ' · ' + t + '\n' + L.today + ': ' + st.today.done + '/' + st.today.goal +
      (st.streak ? L.streakShort(st.streak) : '');
  }
  if (s.status === 'skipped') return L.skipped + ' · ' + t;
  if (s.status === 'missed') return L.missed + ' · ' + t;
  return reminderText_(u, s);
}

function settingsText_(u) {
  const L = L_(u), now = new Date();
  const days = String(u.days).split('').map(function (d) { return L.days[Number(d) - 1]; }).join(' ');
  const perDay = slotsOn_(Object.assign({}, u, { days: '1234567' }), ymd_(now, u.tz)).length;
  const nxt = nextSlot_(u, now);
  let t = L.settingsTitle + '\n' +
    '• ' + L.perSet(u.reps) + '\n' +
    '• ' + L.schedule(u.start_time, u.end_time, u.interval_min, perDay) + '\n' +
    '• ' + L.daysL + ': ' + days + '\n' +
    '• ' + L.tzL + ': ' + u.tz + '\n' +
    '• ' + L.langL + ': ' + L.langName + '\n' +
    '• ' + L.remindersL + ': ' + (u.enabled ? L.on : L.off);
  if (u.enabled && nxt) t += '\n\n' + L.next + ': <b>' + whenLabel_(nxt, u, now) + '</b>';
  return t;
}

function statsText_(u) {
  const L = L_(u), st = computeStats_(u, new Date()), t = st.today;
  let s = L.statsTitle + '\n\n' +
    L.today + ': <b>' + t.done + '</b> / ' + t.goal + (t.goal ? ' (' + Math.round(100 * t.done / t.goal) + '%)' : '') + '\n' +
    L.week + ': <b>' + st.week + '</b> · ' + L.month + ': <b>' + st.month + '</b> · ' + L.total + ': <b>' + st.total + '</b>\n' +
    L.streak(st.streak, st.best_streak);
  if (st.completion_rate !== null) s += '\n' + L.rate(st.completion_rate);
  if (st.best_day) s += '\n' + L.bestDay(L.dateShort(st.best_day.date), st.best_day.done);
  return s;
}

/** Record a set's result and update the reminder message. */
function setResult_(id, status, done) {
  const s = updateSet_(id, { status: status, done: done, answered_at: isoUtc_(new Date()), snooze_until: '' });
  const u = getUser_(s.chat_id);
  if (s.message_id) edit_(s.chat_id, s.message_id, resultText_(u, s));
  return s;
}

function sendReminder_(u, when, s, again) {
  if (!s) s = addSet_(u, when, u.reps);
  const r = send_(u.chat_id, reminderText_(u, s, again), reminderKb_(s, L_(u)));
  if (r.ok) {
    updateSet_(s.id, { message_id: r.result.message_id, sent_at: isoUtc_(new Date()) });
  } else if (r.error_code === 403) { // the user blocked the bot
    deleteSet_(s.id);
    updateUser_(u.chat_id, { enabled: 0 });
  }
}

// ===================== SCHEDULER (called by the Worker's cron) =====================
function tick_() {
  const now = new Date();
  allSets_().filter(function (s) { return s.status === 'pending'; }).forEach(function (s) {
    const u = getUser_(s.chat_id);
    if (!u) return;
    if (s.snooze_until) {
      if (new Date(s.snooze_until) <= now) {
        updateSet_(s.id, { snooze_until: '' });
        sendReminder_(u, null, s, true);
      }
      return;
    }
    const life = Math.min(Math.max(u.interval_min, 30), 180) * 60000;
    if (now - new Date(s.sent_at || s.scheduled_at) >= life) setResult_(s.id, 'missed', 0);
  });

  table_('Users').rows.filter(function (u) { return u.enabled; }).forEach(function (u) {
    const slot = dueSlot_(u, now);
    if (slot && isoUtc_(slot) !== u.last_slot) {
      updateUser_(u.chat_id, { last_slot: isoUtc_(slot) });
      sendReminder_(u, slot);
    }
  });
}

// ===================== MESSAGES FROM TELEGRAM =====================
function handleUpdate_(up) {
  if (up.callback_query) return onCallback_(up.callback_query);
  const m = up.message;
  if (!m || !m.text || m.chat.type !== 'private' || !allowed_(m.from.id)) return;
  const chat = m.chat.id, text = m.text.trim();
  const eu = ensureUser_(chat, m.from.language_code);
  const cmd = text.match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  try {
    if (cmd) return onCommand_(chat, cmd[1].toLowerCase(), (cmd[2] || '').trim(), eu);
    if (/^\d{1,4}$/.test(text)) return onNumber_(chat, Number(text));
    send_(chat, L_(eu.user).notUnderstood);
  } catch (e) {
    if (e instanceof UserError) return send_(chat, '⚠️ ' + e.message);
    throw e;
  }
}

function change_(chat, data) {
  const u = saveSettings_(chat, data);
  send_(chat, L_(u).saved + '\n\n' + settingsText_(u));
}

function onCommand_(chat, cmd, arg, eu) {
  const u = eu.user, L = L_(u);
  switch (cmd) {
    case 'start':
      if (eu.created) tg_('setChatMenuButton', { chat_id: chat, menu_button: menuButton_(L) });
      return send_(chat, (eu.created ? L.hello + '\n\n' : '') + settingsText_(u) + '\n\n' + L.changeHint + '\n\n' + L.help,
        webappKb_(L.btnSettingsStats));
    case 'help': return send_(chat, L.help, webappKb_(L.btnOpenStats));
    case 'settings': return send_(chat, settingsText_(u), webappKb_(L.btnChangeInApp));
    case 'stats': return send_(chat, statsText_(u), webappKb_(L.btnCharts));
    case 'now': return sendReminder_(u, new Date());
    case 'add':
      if (!/^\d{1,4}$/.test(arg)) return send_(chat, L.ex.add);
      return addManual_(chat, Number(arg));
    case 'reps':
      if (!arg) return send_(chat, L.ex.reps);
      return change_(chat, { reps: arg });
    case 'every':
      if (!arg) return send_(chat, L.ex.every);
      return change_(chat, { interval_min: arg });
    case 'hours': {
      const m = arg.match(/^(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?$/);
      if (!m) return send_(chat, L.ex.hours);
      return change_(chat, { start_time: m[1] + ':' + (m[2] || '00'), end_time: m[3] + ':' + (m[4] || '00') });
    }
    case 'days':
      if (!arg) return send_(chat, L.ex.days);
      return change_(chat, { days: arg.replace(/[\s,]/g, '') });
    case 'tz':
      if (!arg) return send_(chat, L.ex.tz);
      return change_(chat, { tz: arg });
    case 'lang': case 'language': case 'mova': {
      const lang = arg.toLowerCase().replace(/^ua$/, 'uk');
      if (LANGS.indexOf(lang) < 0) return send_(chat, L.ex.lang);
      const nu = saveSettings_(chat, { lang: lang });
      return send_(chat, L_(nu).langSet + '\n\n' + settingsText_(nu), webappKb_(L_(nu).btnOpenStats));
    }
    case 'pause': return change_(chat, { enabled: false });
    case 'resume': return change_(chat, { enabled: true });
    default: return send_(chat, L.unknownCmd + '\n\n' + L.help);
  }
}

function addManual_(chat, n) {
  const u = ensureUser_(chat).user, L = L_(u);
  if (n < 1 || n > 1000) return send_(chat, L.range1000);
  addSet_(u, new Date(), n, { done: n, status: 'done', source: 'manual' });
  const st = computeStats_(u, new Date());
  send_(chat, L.logged(n, st.today.done, st.today.goal));
}

function onNumber_(chat, n) {
  const cache = CacheService.getScriptCache();
  const sid = cache.get('aw' + chat);
  if (!sid) return addManual_(chat, n);
  cache.remove('aw' + chat);
  if (!getSet_(sid)) return send_(chat, L_(getUser_(chat)).setNotFound);
  const s = setResult_(Number(sid), n > 0 ? 'done' : 'skipped', n);
  send_(chat, resultText_(getUser_(chat), s));
}

function onCallback_(cq) {
  const answer = function (text) { tg_('answerCallbackQuery', { callback_query_id: cq.id, text: text || '' }); };
  const fallbackL = I18N[langFrom_(cq.from.language_code)];
  if (!allowed_(cq.from.id)) return answer(fallbackL.noAccess);
  const m = String(cq.data || '').match(/^(done|skip|snooze|custom):(\d+)$/);
  if (!m) return answer();
  const s = getSet_(m[2]);
  if (!s || s.chat_id !== cq.from.id) return answer(fallbackL.notFound);
  const u = getUser_(s.chat_id), L = L_(u);

  if (m[1] === 'custom') {
    CacheService.getScriptCache().put('aw' + s.chat_id, String(s.id), 3600);
    answer();
    return send_(s.chat_id, L.askCount, { force_reply: true, input_field_placeholder: L.askPh });
  }
  if (s.status !== 'pending') return answer(L.already);

  if (m[1] === 'done') {
    answer(L.praise[Math.floor(Math.random() * L.praise.length)]);
    setResult_(s.id, 'done', s.planned);
  } else if (m[1] === 'skip') {
    answer(L.skipOk);
    setResult_(s.id, 'skipped', 0);
  } else if (m[1] === 'snooze') {
    const until = new Date(Date.now() + SNOOZE_MIN * 60000);
    updateSet_(s.id, { snooze_until: isoUtc_(until) });
    answer(L.snoozeOk(SNOOZE_MIN));
    edit_(s.chat_id, s.message_id, L.snoozedUntil(hm_(until, u.tz)));
  }
}

// ===================== MINI APP API =====================
function state_(uid) {
  const u = getUser_(uid);
  const recent = allSets_().filter(function (s) { return s.chat_id === uid; })
    .sort(function (a, b) { return a.scheduled_at < b.scheduled_at ? 1 : a.scheduled_at > b.scheduled_at ? -1 : b.id - a.id; })
    .slice(0, 80)
    .map(function (s) {
      const lt = s.local_time || Utilities.formatDate(new Date(s.scheduled_at), u.tz, 'yyyy-MM-dd HH:mm');
      return { id: s.id, date: lt.slice(0, 10), time: lt.slice(11, 16), planned: s.planned, done: s.done, status: s.status, source: s.source };
    });
  return {
    settings: {
      reps: u.reps, start_time: u.start_time, end_time: u.end_time, interval_min: u.interval_min,
      days: u.days, tz: u.tz, enabled: !!u.enabled, lang: u.lang || 'en',
    },
    stats: computeStats_(u, new Date()),
    recent: recent,
  };
}

function handleApi_(uid, method, path, body, langCode) {
  if (!allowed_(uid)) return { status: 403, body: { detail: I18N[langFrom_(langCode)].noAccess } };
  const u = ensureUser_(uid, langCode).user, L = L_(u);
  try {
    if (method === 'GET' && path === '/state') return { status: 200, body: state_(uid) };
    if (method === 'PUT' && path === '/settings') { saveSettings_(uid, body || {}); return { status: 200, body: state_(uid) }; }
    if (method === 'POST' && path === '/sets') {
      const n = Number(body && body.done);
      if (!(n >= 1 && n <= 1000)) throw new UserError(L.range1000);
      addSet_(u, new Date(), n, { done: n, status: 'done', source: 'manual' });
      return { status: 200, body: state_(uid) };
    }
    const m = path.match(/^\/sets\/(\d+)$/);
    if (m) {
      const s = getSet_(m[1]);
      if (!s || s.chat_id !== uid) return { status: 404, body: { detail: L.setNotFound } };
      if (method === 'PATCH') {
        const n = Number(body && body.done);
        if (!(n >= 0 && n <= 1000)) throw new UserError(L.range1000);
        setResult_(s.id, n > 0 ? 'done' : 'skipped', n);
        return { status: 200, body: state_(uid) };
      }
      if (method === 'DELETE') {
        if (s.status === 'pending') setResult_(s.id, 'skipped', 0); // remove the buttons from the message
        deleteSet_(s.id);
        return { status: 200, body: state_(uid) };
      }
    }
    return { status: 404, body: { detail: 'Not found' } };
  } catch (e) {
    if (e instanceof UserError) return { status: 400, body: { detail: e.message } };
    throw e;
  }
}
