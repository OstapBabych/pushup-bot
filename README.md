# 💪 Pushup Bot

**English** · [Українська](README.uk.md)

A Telegram bot that reminds you to do push-ups throughout the day, plus a Telegram Mini App with stats and settings.
Runs **24/7 for free** with no server of your own: Cloudflare Workers + Google Apps Script, with a plain Google Sheet as the database.

> 🌐 The bot and the Mini App speak **English** and **Ukrainian**. The language is picked automatically from your Telegram language and can be changed with `/lang` or in the Mini App settings.

## Features

- ⏰ Scheduled reminders: how many push-ups, from what time until what time, how often, on which days of the week, in your time zone.
- Every reminder has buttons: **✅ Done · ✏️ Other amount · ⏰ +10 min · ❌ Skip**.
- If you don't answer before the next reminder, the set is automatically marked as "😴 missed".
- 📊 Mini App inside Telegram:
  - **Stats**: today's progress, day streak, % of reminders completed, 30-day chart, activity heatmap, breakdown by hour.
  - **History**: every set; edit the amount, delete a set or add one manually.
  - **Settings**: everything above without typing commands.
- Everything also works with commands (see [Bot commands](#bot-commands)). Sending a plain number logs it as a set.
- Your data lives in your own Google Sheet, so you can view it, edit it and build your own charts.
- 🌐 English and Ukrainian: chosen automatically, switchable any time.

## How it works

```
                ┌───────────────────────── Cloudflare Worker (*.workers.dev) ─────────────────────────┐
Telegram ──────▶│ /tg     webhook: replies 200 immediately, forwards the update to Apps Script        │
Mini App ──────▶│ /api/*  verifies the Telegram signature (initData) and proxies to Apps Script       │
User ──────────▶│ /       serves the Mini App itself (HTML is bundled into worker.js)                 │
Cron (1/min) ──▶│ scheduled → "tick" in Apps Script                                                   │
                └───────────────────────────────────────┬─────────────────────────────────────────────┘
                                                        ▼
                               Google Apps Script (doPost) ──▶ Google Sheet (Users, Sets tabs)
                                       │
                                       └──▶ Telegram Bot API (sends messages)
```

Why a Worker instead of calling Apps Script directly? Apps Script answers Telegram's webhook with a `302` redirect. Telegram treats that as a failure and keeps retrying, so the bot replies several times or gets stuck. The Worker answers Telegram instantly, gives you a free HTTPS address for the Mini App, and provides a free cron.

The Worker and Apps Script authenticate each other with a shared `SECRET`, so even if someone finds your Apps Script URL, they can't do anything with it.

## Repository layout

```
apps-script/Code.gs      bot logic: schedule, buttons, commands, stats, API, Google Sheet storage
worker/worker.src.js     Cloudflare Worker source
worker/worker.js         GENERATED file (worker.src.js + Mini App): this is what you paste into Cloudflare
webapp/index.html        the Mini App (single HTML file, Chart.js from a CDN)
scripts/build.mjs        builds worker/worker.js
tests/harness.mjs        tests with mocked Google and Telegram services (npm test)
wrangler.toml            config for deploying the Worker from the terminal (optional)
```

---

# 🚀 Setup from scratch

You'll need a Telegram account, a Google account and a free Cloudflare account. It takes about 15 minutes.

Order matters: create the Worker first (to get its URL), then Apps Script, then connect them.

## Step 1. Create the Telegram bot

1. Open [@BotFather](https://t.me/BotFather) → `/newbot`.
2. Enter a name (anything) and a username (must end in `bot`, e.g. `my_pushup_bot`).
3. BotFather sends you a **token** like `1234567890:AAH...`. Keep it: this is your `BOT_TOKEN`.
4. Find your Telegram id: message [@userinfobot](https://t.me/userinfobot) and it replies with a number. This goes into `ALLOWED_USER_IDS`, so nobody else can use your bot.

> ⚠️ The token is the password to your bot. Never put it in code, screenshots or GitHub. If it leaks, run `/revoke` in BotFather and update it in Apps Script and Cloudflare.

## Step 2. Create the Cloudflare Worker

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** (under **Compute**) → **Create**.
2. Choose **Start with Hello World!** (⚠️ **not** "Upload and deploy" / "Drag and drop": that option is for static files only, and Worker code won't run there).
3. Name the Worker `pushup-bot` → **Deploy**.
4. Note the Worker URL, e.g. `https://pushup-bot.your-name.workers.dev`. This is your `WEBAPP_URL`.
5. Click **Edit code**, delete everything in the editor, paste the **entire** contents of [`worker/worker.js`](worker/worker.js) → **Deploy**.

You'll add the variables in step 4, once you have the Apps Script URL.

## Step 3. Google Sheet + Apps Script

1. Create a new [Google Sheet](https://sheets.new), e.g. "Pushups".
2. **Extensions → Apps Script**. This opens an editor bound to that sheet.
3. Delete all the code in `Code.gs` and paste the contents of [`apps-script/Code.gs`](apps-script/Code.gs). Click 💾 (Save).
4. On the left: ⚙️ **Project Settings** → **Script Properties** at the bottom → **Add script property**, and add:

   | Property | Value |
   |---|---|
   | `BOT_TOKEN` | the token from step 1 |
   | `WEBAPP_URL` | the Worker URL from step 2 (**no** trailing `/`) |
   | `ALLOWED_USER_IDS` | your Telegram id (comma-separated for several). Empty = anyone can use the bot |
   | `DEFAULT_TZ` | *(optional)* e.g. `Europe/Berlin`. Defaults to `Europe/London` |

   → **Save script properties**.
5. Go back to the editor (`<>` on the left). In the function dropdown at the top, select **`setup`** → **Run**.
   - Google will ask for permission: **Review permissions** → choose your account → "Google hasn't verified this app" → **Advanced** → **Go to … (unsafe)** → **Allow**. It's your own script, so this warning is expected.
   - The Execution log shows a line
     `🔑 SECRET (put it into the Cloudflare Worker as the SECRET variable): 3f2a…`
     **Copy that SECRET**: you'll need it in step 4. (It's also saved in Script Properties.)
   - Then `✅ Done! Send /start to your bot`. The `Users` and `Sets` tabs appear in your sheet.
6. **Deploy → New deployment** → click ⚙️ next to "Select type" → **Web app**:
   - **Execute as:** Me
   - **Who has access:** **Anyone** (exactly "Anyone", not "Anyone with Google account")
   - **Deploy** → copy the **Web app URL** (ends with `/exec`). This is your `GAS_URL`.

## Step 4. Worker variables and cron

1. Cloudflare → **Workers & Pages → pushup-bot → Settings**.
2. Under **Variables and Secrets** → **+ Add** each of these:

   | Name | Type | Value |
   |---|---|---|
   | `BOT_TOKEN` | Secret | the bot token |
   | `SECRET` | Secret | the SECRET from the `setup` log |
   | `GAS_URL` | Secret or Text | the `…/exec` URL from step 3.6 |
   | `ALLOWED_USER_IDS` | Text | your Telegram id (same as in Apps Script) |

   → **Deploy**. Paste values with no spaces or line breaks.
3. In the same place, under **Trigger Events** (or **Triggers**) → **+ Add → Cron Triggers** → `* * * * *` (every minute) → **Add**.

## Step 5. Check it works

1. Open `https://pushup-bot.your-name.workers.dev/health` in a browser. You should see
   `{"worker":"ok","apps_script":"ok"}`.
2. Send `/start` to your bot in Telegram. You'll get a welcome message with your settings.
3. Send `/now`. A reminder with buttons arrives. Tap **✅ Done**: a row with status `done` appears in the `Sets` tab of your sheet.
4. Close and reopen the chat with the bot. A **📊 Stats** button appears next to the message box: that's the Mini App.

Done 🎉 Set your schedule in the Mini App (⚙️ tab) or with commands.

---

## Bot commands

| Command | What it does |
|---|---|
| `/start` | welcome message and current settings |
| `/stats` | stats as text |
| `/settings` | current settings |
| `/now` | send a reminder right now |
| `/add 25` | log a set manually (or just send `25`) |
| `/reps 20` | push-ups per reminder |
| `/hours 9-21` | active hours (also `9:30-21:15`) |
| `/every 60` | interval in minutes (5–720) |
| `/days 12345` | days of the week: 1 = Mon … 7 = Sun |
| `/tz Europe/London` | time zone ([list](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)) |
| `/lang en`, `/lang uk` | bot and Mini App language |
| `/pause`, `/resume` | turn reminders off / on |

## Languages

- A new user gets **Ukrainian** if their Telegram app is in Ukrainian, otherwise **English**.
- Switch any time: `/lang en` / `/lang uk`, or **Settings → Language** in the Mini App. The bot's messages, buttons, the "📊" menu button and the Mini App all follow the chosen language.
- The command menu (the "/" list) follows the language of the Telegram app itself.
- Adding another language: copy the `en` block in `I18N` in `apps-script/Code.gs` and in `webapp/index.html`, translate it and add the code to `LANGS`.

## How reminders work

- The Worker's cron calls Apps Script every minute. Apps Script works out the day's slots (from "start" to "end" in steps of "interval", only on the selected days, in your time zone) and sends a reminder when a new slot begins.
- If the system was down and a slot was missed by more than 15 minutes, that old reminder is not sent.
- "⏰ +10 min" hides the buttons and sends the reminder again 10 minutes later.
- No answer within one `interval` (at least 30 min, at most 3 h) → status `missed`.
- Daily goal = number of reminders × push-ups per reminder. Streak = consecutive days with at least one push-up.

## The sheet (database)

**`Users`**: settings: `chat_id, reps, start_time, end_time, interval_min, days, tz, enabled, last_slot, created_at, lang`.

**`Sets`**: one row per set:

| column | meaning |
|---|---|
| `local_time` | date and time in your time zone (`2026-11-19 14:00`) |
| `planned` / `done` | planned / actually done |
| `status` | `done` · `skipped` · `missed` · `pending` |
| `source` | `reminder` or `manual` |
| the rest | internal fields (UTC time, message id, etc.) |

You can build your own pivot tables and charts. Editing rows by hand is fine, but don't reorder the columns or change the headers.

---

## 🔄 Updating the code

**Apps Script.** After any change to `Code.gs` you must do **Deploy → Manage deployments → ✏️ (Edit) → Version: New version → Deploy**. Otherwise the `/exec` URL keeps running the old code. The URL itself doesn't change.

**Worker.** Change `worker/worker.src.js` or `webapp/index.html` → `npm run build` → paste the new `worker/worker.js` into the Cloudflare editor → **Deploy** (or use `npm run deploy`, see below).

### Deploying the Worker from the terminal (optional)

```bash
npm i -g wrangler        # or use npx wrangler
wrangler login
npx wrangler secret put BOT_TOKEN
npx wrangler secret put SECRET
npx wrangler secret put GAS_URL
npx wrangler secret put ALLOWED_USER_IDS
npm run deploy           # builds worker.js and deploys it together with the cron from wrangler.toml
```

### Upgrading an existing installation

Paste the new `apps-script/Code.gs` → **New version** deploy, and paste the new `worker/worker.js` → **Deploy**. Your data stays as it is: new columns (e.g. `lang`) are added to the sheet automatically. Run `setup` once more to get the bilingual command menu.

### Development and tests

```bash
npm run build   # build worker/worker.js
npm test        # tests: schedule, buttons, commands, API, DST change, initData signature
```
Only Node.js 18+ is needed; there are no dependencies.

---

## 🛠 Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The bot doesn't reply at all | Open `https://api.telegram.org/bot<TOKEN>/getWebhookInfo` and check `url` and `last_error_message`. Or run the `webhookInfo` function in Apps Script. |
| `last_error_message: 404 Not Found` and the `url` has a double slash `…dev//tg` | `WEBAPP_URL` ends with `/`. Remove it and run `setup` again. |
| `last_error_message: 403` | `SECRET` in the Worker doesn't match `SECRET` in Script Properties. |
| `/health` shows an Apps Script error | Check `GAS_URL` (must end with `/exec`) and that the deployment has "Who has access: **Anyone**". `SECRET` must match too. |
| The Mini App opens but is empty / settings are blank | The Worker returns `401`: wrong `BOT_TOKEN` in the Worker variables (extra space, line break, wrong name). Re-enter it. |
| Mini App says "Access denied" | Your id isn't in the Worker's `ALLOWED_USER_IDS`. |
| You changed the code but the bot behaves the old way | You didn't create a **New version** in Manage deployments (see "Updating the code"). |
| No "📊 Stats" button | Close and reopen the chat. `setup` sets the button, so run it again if you changed `WEBAPP_URL`. |
| Reminders don't arrive | Check the Worker's Cron Trigger (`* * * * *`), that reminders aren't paused (`/settings`), and that today and the current time are inside your schedule. |
| Cloudflare says "This uploader does not yet support projects that require a build process" | You're in "Upload and deploy" mode. Use **Start with Hello World!** → **Edit code** instead (step 2). |

**Logs:** Worker → **Logs** (Real-time logs); Apps Script → **Executions** in the left menu.

## Free tier limits

- **Cloudflare Workers Free:** 100,000 requests per day. The bot uses about 1,500 (cron every minute plus your actions).
- **Apps Script (personal account):** 20,000 `UrlFetch` calls per day and up to 30 simultaneous executions. That's plenty for one or a few users.
- A sheet with a few thousand rows stays fast. If `Sets` ever grows to tens of thousands of rows, move old rows to an archive tab.

## Security

- Secrets (`BOT_TOKEN`, `SECRET`, `GAS_URL`) live only in Script Properties and Worker variables. **They are not in the code**, so the repository can be public.
- The webhook only accepts requests with the `X-Telegram-Bot-Api-Secret-Token` header.
- The Mini App API verifies Telegram's `initData` signature (HMAC-SHA256) and `ALLOWED_USER_IDS`.
- Apps Script only accepts requests that carry the correct `SECRET`.
