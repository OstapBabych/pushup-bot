// Тести: запускає apps-script/Code.gs з імітацією сервісів Google і Telegram,
// а потім worker/worker.js наскрізно поверх нього. Запуск: npm test
import fs from "fs";
import vm from "vm";
import crypto from "crypto";
import assert from "assert";

const ROOT = new URL("..", import.meta.url).pathname;
let FAKE_NOW = null; // ms or null
const RealDate = Date;
class FDate extends RealDate {
  constructor(...a) { if (a.length === 0 && FAKE_NOW !== null) super(FAKE_NOW); else super(...a); }
  static now() { return FAKE_NOW ?? RealDate.now(); }
}

// ---------- mocks ----------
function pad(n, w = 2) { return String(n).padStart(w, "0"); }
function partsIn(date, tz) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" });
  const o = {}; for (const p of f.formatToParts(date)) o[p.type] = p.value;
  let off = o.timeZoneName.replace("GMT", "") || "+00:00";
  return { y: o.year, M: o.month, d: o.day, H: o.hour, m: o.minute, s: o.second, Z: off.replace(":", "") };
}
const Utilities = {
  getUuid() { return crypto.randomUUID(); },
  formatDate(date, tz, fmt) {
    let zone = tz;
    try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { zone = "UTC"; } // Java: unknown -> GMT
    const p = partsIn(date, zone);
    let out = "", i = 0;
    while (i < fmt.length) {
      if (fmt[i] === "'") { const j = fmt.indexOf("'", i + 1); out += fmt.slice(i + 1, j); i = j + 1; continue; }
      const m = fmt.slice(i).match(/^(yyyy|MM|dd|HH|H|mm|ss|zzzz|Z)/);
      if (m) {
        const t = m[1];
        out += t === "yyyy" ? p.y : t === "MM" ? p.M : t === "dd" ? p.d : t === "HH" ? p.H : t === "H" ? String(Number(p.H)) : t === "mm" ? p.m : t === "ss" ? p.s
          : t === "Z" ? p.Z : (zone === "UTC" && tz !== "UTC" ? "Greenwich Mean Time" : "Some Time");
        i += t.length;
      } else { out += fmt[i]; i++; }
    }
    return out;
  },
};
class Sheet {
  constructor(name) { this.name = name; this.data = []; }
  getDataRange() { const d = this.data; return { getValues: () => d.map((r) => r.slice()) }; }
  getRange(r, c, nr, nc) {
    const sh = this;
    const api = {
      setValues(v) { for (let i = 0; i < nr; i++) { sh.data[r - 1 + i] ||= []; for (let j = 0; j < nc; j++) sh.data[r - 1 + i][c - 1 + j] = clean(v[i][j]); } return api; },
      setFontWeight() { return api; },
    };
    return api;
  }
  appendRow(row) { this.data.push(row.map(clean)); }
  getLastRow() { return this.data.length; }
  deleteRow(r) { this.data.splice(r - 1, 1); }
  setFrozenRows() {}
}
function clean(v) { return typeof v === "string" && v.startsWith("'") ? v.slice(1) : v; }
const sheets = {};
const ss = { getId: () => "SID", getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = new Sheet(n)) };
const TOKEN = "123456789:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz";
const props = { BOT_TOKEN: TOKEN, WEBAPP_URL: "https://pb.test.workers.dev/", ALLOWED_USER_IDS: "111222333, 444" };
let cache = {};
const tgCalls = [];
let msgId = 100;
let tgFail = null;
const ctx = {
  console, Date: FDate, Math, JSON, Object, Number, String, Array, isFinite, Error,
  Utilities,
  SpreadsheetApp: { getActive: () => ss, openById: () => ss, flush() {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => (props[k] = v) }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => (cache[k] = v), remove: (k) => delete cache[k] }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  UrlFetchApp: {
    fetch(url, opt) {
      const method = url.split("/").pop(); const p = JSON.parse(opt.payload);
      tgCalls.push({ method, p });
      let res = { ok: true, result: true };
      if (tgFail && tgFail.method === method) res = tgFail.res;
      else if (method === "sendMessage") res = { ok: true, result: { message_id: ++msgId } };
      return { getContentText: () => JSON.stringify(res) };
    },
  },
  ContentService: { createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }), MimeType: { JSON: "json" } },
};
vm.createContext(ctx);
const code = fs.readFileSync(`${ROOT}apps-script/Code.gs`, "utf8");
vm.runInContext(code + "\n;globalThis.__exports={doPost,setup,TABLES_,resetCfg:()=>{CFG_=null}};", ctx);
const G = ctx.__exports;
let SECRET;
const resetTables = () => { for (const k of Object.keys(G.TABLES_)) delete G.TABLES_[k]; G.resetCfg(); };

function post(payload) {
  resetTables(); // new execution each call, like real GAS
  const r = G.doPost({ postData: { contents: JSON.stringify(payload) } });
  return JSON.parse(r.content);
}
let uid = 1;
const ME = 111222333;
const msg = (text, from = ME, lang = "uk") => post({ secret: SECRET, kind: "update", update: { update_id: uid++, message: { chat: { id: from, type: "private" }, from: { id: from, language_code: lang }, text } } });
const cb = (data, from = ME) => post({ secret: SECRET, kind: "update", update: { update_id: uid++, callback_query: { id: "q" + uid, from: { id: from, language_code: "uk" }, data } } });
const tick = () => post({ secret: SECRET, kind: "tick" });
const api = (method, path, body) => post({ secret: SECRET, kind: "api", uid: ME, method, path, body });
const lastSend = () => tgCalls.filter((c) => c.method === "sendMessage").at(-1);
const setsRows = () => sheets.Sets.data.slice(1);
const at = (iso) => { FAKE_NOW = RealDate.parse(iso); };

// ---------- tests ----------
// setup without properties must fail with a clear message
const saved = { ...props }; delete props.BOT_TOKEN;
resetTables(); assert.throws(() => G.setup(), /BOT_TOKEN/); Object.assign(props, saved);
resetTables(); G.setup(); SECRET = props.SECRET; assert.match(SECRET, /^[0-9a-f]{32}$/);
assert(tgCalls.find((c) => c.method === "setWebhook").p.url === "https://pb.test.workers.dev/tg");
assert.deepEqual(sheets.Users.data[0].slice(0, 3), ["chat_id", "reps", "start_time"]);

// wrong secret
assert.equal(post({ secret: "x", kind: "tick" }).status, 403);
assert.equal(post({ secret: "", kind: "tick" }).status, 403);

at("2026-11-18T13:05:00Z");
msg("/start");
assert.match(lastSend().p.text, /Привіт/);
assert.equal(sheets.Users.data[1][0], ME);
assert.equal(sheets.Users.data[1][2], "09:00", "time stored as text");
// registration at 13:05 must NOT trigger the 13:00 reminder
tick(); assert.equal(setsRows().length, 0, "no immediate reminder after /start");

// duplicate update ignored
const before = tgCalls.length;
post({ secret: SECRET, kind: "update", update: { update_id: uid - 1, message: { chat: { id: ME, type: "private" }, from: { id: ME }, text: "/stats" } } });
assert.equal(tgCalls.length, before, "dup update ignored");

// stranger ignored
const n0 = tgCalls.length; msg("/start", 999); assert.equal(tgCalls.length, n0);

// reminder at 14:00
at("2026-11-18T14:00:30Z"); tick();
assert.equal(setsRows().length, 1); let s = lastSend();
assert.match(s.p.text, /Час віджиматися/); assert.match(s.p.text, /0\/195/);
assert.equal(s.p.reply_markup.inline_keyboard[0][0].callback_data, "done:1");
tick(); assert.equal(setsRows().length, 1, "no duplicate reminder");

// done
cb("done:1");
assert.equal(setsRows()[0][5], "done"); assert.equal(setsRows()[0][4], 15);
const ed = tgCalls.filter((c) => c.method === "editMessageText").at(-1); assert.match(ed.p.text, /Зроблено: 15/); assert.match(ed.p.text, /🔥 1/);
cb("done:1"); assert.match(tgCalls.at(-1).p.text, /Вже відмічено/);

// snooze flow at 15:00
at("2026-11-18T15:00:10Z"); tick(); assert.equal(setsRows().length, 2);
cb("snooze:2"); assert.match(tgCalls.filter((c) => c.method === "editMessageText").at(-1).p.text, /Нагадаю о 15:10/);
at("2026-11-18T15:05:00Z"); const k = tgCalls.length; tick(); assert.equal(tgCalls.length, k, "not yet");
at("2026-11-18T15:10:30Z"); tick(); assert.match(lastSend().p.text, /ще раз/);
// custom count
cb("custom:2"); msg("22"); assert.equal(setsRows()[1][4], 22); assert.match(lastSend().p.text, /Зроблено: 22/);

// missed: 16:00 reminder, no answer, 17:00 new
at("2026-11-18T16:00:00Z"); tick();
at("2026-11-18T17:00:00Z"); tick();
assert.equal(setsRows()[2][5], "missed"); assert.equal(setsRows()[3][5], "pending");

// plain number = manual
msg("30"); assert.match(lastSend().p.text, /Записав 30/); assert.equal(setsRows()[4][6], "manual");

// commands
msg("/reps 20"); assert.match(lastSend().p.text, /20 віджимань за раз/);
msg("/hours 9:30-20"); assert.match(lastSend().p.text, /з 09:30 до 20:00/);
msg("/hours 22-9"); assert.match(lastSend().p.text, /раніше за кінець/);
msg("/tz Mars/Base"); assert.match(lastSend().p.text, /Невідомий часовий пояс/);
msg("/tz Europe/Kyiv"); assert.match(lastSend().p.text, /Europe\/Kyiv/);
msg("/days 12345"); assert.match(lastSend().p.text, /Пн Вт Ср Чт Пт/);
msg("/every 0"); assert.match(lastSend().p.text, /від 5 до 720/);
msg("/pause"); assert.match(lastSend().p.text, /на паузі/);
msg("/resume"); assert.match(lastSend().p.text, /увімкнені/);
msg("/stats"); console.log(lastSend().p.text);
msg("/settings"); console.log(lastSend().p.text);
msg("/now"); assert.match(lastSend().p.text, /Час віджиматися/);
msg("hello"); assert.match(lastSend().p.text, /Не зрозумів/);

// ---- English ----
msg("/lang en"); assert.match(lastSend().p.text, /Language set to English/); assert.match(lastSend().p.text, /push-ups per reminder/);
assert(tgCalls.some((c) => c.method === "setChatMenuButton" && c.p.chat_id === ME && c.p.menu_button.text === "📊 Stats"));
msg("/stats"); assert.match(lastSend().p.text, /Stats/); assert.match(lastSend().p.text, /Streak/); console.log(lastSend().p.text);
msg("/now"); assert.match(lastSend().p.text, /Push-up time/); assert.equal(lastSend().p.reply_markup.inline_keyboard[1][1].text, "❌ Skip");
msg("/reps 0"); assert.match(lastSend().p.text, /Push-ups: from 1 to 1000/);
msg("/lang xx"); assert.match(lastSend().p.text, /Choose a language/);
msg("blah"); assert.match(lastSend().p.text, /Didn't get that/);
msg("/settings"); assert.match(lastSend().p.text, /language: English/);
msg("/lang uk"); assert.match(lastSend().p.text, /українську/);
// new user: language from Telegram (en by default, uk for Ukrainian clients)
msg("/start", 444, "en-GB"); assert.match(lastSend().p.text, /Hi! I'll remind you/);
msg("/start", 444, "uk"); assert.doesNotMatch(lastSend().p.text, /Привіт/, "existing user keeps chosen lang");
assert.match(lastSend().p.text, /Settings/);
// existing user without a language (older sheet) gets it from Telegram on the next message
{ const row = sheets.Users.data.find((r) => r[0] === 444); row[10] = ""; }
msg("/settings", 444, "uk"); assert.match(lastSend().p.text, /Налаштування/);
assert.equal(sheets.Users.data[0][10], "lang");

// API
let r = api("GET", "/state"); assert.equal(r.status, 200);
console.log("today", JSON.stringify(r.body.stats.today), "streak", r.body.stats.streak, "recent", r.body.recent.length, "heat", r.body.stats.heatmap.length, "rate", r.body.stats.completion_rate);
assert.equal(r.body.stats.today.done, 15 + 22 + 30);
r = api("PUT", "/settings", { lang: "en" }); assert.equal(r.body.settings.lang, "en"); assert.match(r.body.stats.next_reminder || "today", /today|tomorrow|\//);
assert.equal(api("PUT", "/settings", { start_time: "23:00" }).body.detail, "Start must be earlier than end");
assert.equal(api("PUT", "/settings", { lang: "de" }).status, 400);
api("PUT", "/settings", { lang: "uk" });
r = api("PUT", "/settings", { reps: 25, start_time: "08:00", end_time: "22:00", interval_min: 45, days: "1234567", tz: "Europe/London", enabled: true });
assert.equal(r.status, 200); assert.equal(r.body.settings.reps, 25); assert.equal(r.body.settings.interval_min, 45);
assert.equal(api("PUT", "/settings", { start_time: "23:00" }).status, 400);
r = api("POST", "/sets", { done: 40 }); const newId = r.body.recent[0].id; assert.equal(r.body.recent[0].done, 40);
r = api("PATCH", `/sets/${newId}`, { done: 41 }); assert.equal(r.body.recent.find((x) => x.id === newId).done, 41);
r = api("DELETE", `/sets/${newId}`); assert(!r.body.recent.find((x) => x.id === newId));
assert.equal(api("PATCH", "/sets/9999", { done: 1 }).status, 404);
assert.equal(api("GET", "/nope").status, 404);
// delete in middle keeps rows consistent
const ids = setsRows().map((x) => x[0]);
api("DELETE", "/sets/2");
assert.deepEqual(setsRows().map((x) => x[0]), ids.filter((x) => x !== 2));
assert.equal(api("GET", "/state").status, 200);

// DST: Europe/London 2027-03-28 springs forward; 09:00 local = 08:00Z
api("PUT", "/settings", { tz: "Europe/London", start_time: "09:00", end_time: "21:00", interval_min: 60, days: "1234567" });
at("2027-03-28T08:00:20Z"); const c1 = setsRows().length; tick(); assert.equal(setsRows().length, c1 + 2, "DST 09:00 local slot (both users)");
assert.equal(setsRows().at(-1)[2], "2027-03-28 09:00");

// blocked user
at("2027-03-28T09:00:20Z"); tgFail = { method: "sendMessage", res: { ok: false, error_code: 403, description: "blocked" } };
const c2 = setsRows().length; tick(); tgFail = null;
assert.equal(setsRows().length, c2, "set removed"); assert.equal(sheets.Users.data[1][7], 0, "disabled");
console.log("GAS OK ✅");

// ---------- worker e2e ----------
FAKE_NOW = null;
const wsrc = fs.readFileSync(`${ROOT}worker/worker.js`, "utf8");
const wpath = `${(await import("os")).tmpdir()}/pushup-worker-${process.pid}.mjs`;
fs.writeFileSync(wpath, wsrc);
const worker = (await import(wpath)).default;
fs.unlinkSync(wpath);
const env = { BOT_TOKEN: TOKEN + "\n", SECRET: " " + SECRET, GAS_URL: "https://script.google.com/macros/s/X/exec", ALLOWED_USER_IDS: String(ME) };
globalThis.fetch = async (url, opt) => {
  assert.equal(url, env.GAS_URL); assert.equal(opt.redirect, "follow");
  resetTables();
  const out = G.doPost({ postData: { contents: opt.body } });
  return new Response(out.content);
};
const waits = [];
const wctx = { waitUntil: (p) => waits.push(p) };
function initData(id) {
  const p = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: "q", user: JSON.stringify({ id, first_name: "T" }), signature: "sig" };
  const chk = Object.keys(p).sort().map((k) => `${k}=${p[k]}`).join("\n");
  const sec = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  p.hash = crypto.createHmac("sha256", sec).update(chk).digest("hex");
  return new URLSearchParams(p).toString();
}
let res = await worker.fetch(new Request("https://pb.test/"), env, wctx);
assert.equal(res.status, 200); assert.match(await res.text(), /Pushups/);
res = await worker.fetch(new Request("https://pb.test/tg", { method: "POST", body: "{}" }), env, wctx);
assert.equal(res.status, 403);
res = await worker.fetch(new Request("https://pb.test/tg", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": SECRET },
  body: JSON.stringify({ update_id: 777777, message: { chat: { id: ME, type: "private" }, from: { id: ME }, text: "/stats" } }) }), env, wctx);
assert.equal(res.status, 200); await Promise.all(waits); assert.match(lastSend().p.text, /Статистика/);
res = await worker.fetch(new Request("https://pb.test//tg", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": SECRET }, body: JSON.stringify({ update_id: 777778, message: { chat: { id: ME, type: "private" }, from: { id: ME }, text: "/help" } }) }), env, wctx);
assert.equal(res.status, 200, "double slash path tolerated");
res = await worker.fetch(new Request("https://pb.test/api/state"), env, wctx); assert.equal(res.status, 401);
res = await worker.fetch(new Request("https://pb.test/api/state", { headers: { "X-Init-Data": initData(ME) } }), env, wctx);
assert.equal(res.status, 200); const st = await res.json(); assert(st.stats && st.settings);
res = await worker.fetch(new Request("https://pb.test/api/state", { headers: { "X-Init-Data": initData(5) } }), env, wctx); assert.equal(res.status, 403);
res = await worker.fetch(new Request("https://pb.test/api/state", { headers: { "X-Init-Data": initData(ME).replace("auth_date=", "auth_date=1") } }), env, wctx); assert.equal(res.status, 401);
res = await worker.fetch(new Request("https://pb.test/api/sets", { method: "POST", headers: { "X-Init-Data": initData(ME), "content-type": "application/json" }, body: JSON.stringify({ done: 12 }) }), env, wctx);
assert.equal(res.status, 200); { const rr=(await res.json()).recent; const mx=rr.reduce((a,b)=>b.id>a.id?b:a); assert.equal(mx.done, 12); }
res = await worker.fetch(new Request("https://pb.test/api/settings", { method: "PUT", headers: { "X-Init-Data": initData(ME) }, body: JSON.stringify({ start_time: "23:00" }) }), env, wctx);
assert.equal(res.status, 400); console.log((await res.json()).detail);
waits.length = 0; await worker.scheduled({}, env, wctx); await Promise.all(waits);
res = await worker.fetch(new Request("https://pb.test/health"), env, wctx); console.log(await res.text());
console.log("WORKER OK ✅");
