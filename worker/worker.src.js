/**
 * 💪 Pushup Bot — Cloudflare Worker
 *  /tg      ← вебхук Telegram: одразу відповідає 200, а апдейт у фоні передає в Apps Script
 *  /api/*   ← API міні-аппу: перевіряє підпис Telegram initData і проксіює в Apps Script
 *  /        ← сам міні-апп (HTML вбудований нижче)
 *  cron     → щохвилини «tick» в Apps Script (надіслати нагадування)
 *
 * Змінні (Settings → Variables and Secrets):
 *   BOT_TOKEN  (Secret)  — токен бота
 *   SECRET     (Secret)  — той самий, що SECRET у Code.gs
 *   GAS_URL    (Text)    — https://script.google.com/macros/s/…/exec
 *   ALLOWED_USER_IDS (Text, необов'язково) — напр. 111222333
 */

const HTML = __HTML__;

export default {
  async fetch(request, env, ctx) {
    env = cleanEnv(env);
    const url = new URL(request.url);
    url.pathname = url.pathname.replace(/\/{2,}/g, "/");

    if (url.pathname === "/tg" && request.method === "POST") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const update = await request.json();
      ctx.waitUntil(callGas(env, { kind: "update", update }));
      return new Response("ok");
    }

    if (url.pathname.startsWith("/api/")) {
      const uid = await validateInitData(request.headers.get("X-Init-Data") || "", env.BOT_TOKEN);
      if (!uid) return json({ detail: "Відкрий міні-апп через Telegram" }, 401);
      const allowed = String(env.ALLOWED_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (allowed.length && !allowed.includes(String(uid))) return json({ detail: "Немає доступу" }, 403);
      let body = null;
      if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
        body = await request.json().catch(() => ({}));
      }
      const res = await callGas(env, { kind: "api", uid, method: request.method, path: url.pathname.slice(4), body });
      return json(res.body, res.status || 200);
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
    }
    if (url.pathname === "/health") {
      const r = await callGas(env, { kind: "ping" });
      return json({ worker: "ok", apps_script: r.status === 400 ? "ok" : r });
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    env = cleanEnv(env);
    ctx.waitUntil(callGas(env, { kind: "tick" }));
  },
};

function cleanEnv(env) {
  const out = {};
  for (const k of ["BOT_TOKEN", "SECRET", "GAS_URL", "ALLOWED_USER_IDS"]) out[k] = String(env[k] || "").trim();
  return out;
}

async function callGas(env, payload) {
  try {
    const r = await fetch(env.GAS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, secret: env.SECRET }),
      redirect: "follow",
    });
    const text = await r.text();
    try {
      return JSON.parse(text);
    } catch {
      console.log("Apps Script returned non-JSON:", r.status, text.slice(0, 300));
      return { status: 502, body: { detail: "Apps Script не відповів як треба. Перевір GAS_URL і доступ «Anyone»." } };
    }
  } catch (e) {
    console.log("Apps Script fetch failed:", e && e.message);
    return { status: 502, body: { detail: "Не вдалось достукатись до Apps Script" } };
  }
}

const enc = new TextEncoder();

async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, typeof data === "string" ? enc.encode(data) : data));
}

/** Перевірка підпису Telegram WebApp initData. Повертає user id або null. */
async function validateInitData(initData, token) {
  if (!initData || !token) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await hmac(enc.encode("WebAppData"), token);
  const calc = [...(await hmac(secret, check))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (calc !== hash) return null;
  if (Date.now() / 1000 - Number(params.get("auth_date") || 0) > 7 * 24 * 3600) return null;
  try {
    return JSON.parse(params.get("user")).id;
  } catch {
    return null;
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
