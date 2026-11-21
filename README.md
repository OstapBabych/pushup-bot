# 💪 Pushup Bot

Telegram-бот, який протягом дня нагадує віджиматися, і міні-апп зі статистикою та налаштуваннями.
Працює **24/7 і безкоштовно**: без власного сервера, на Cloudflare Workers + Google Apps Script, а база даних — звичайна Google Таблиця.

## Можливості

- ⏰ Нагадування за розкладом: скільки віджимань, з якої до якої години, як часто, в які дні тижня, у твоєму часовому поясі.
- Під кожним нагадуванням кнопки **✅ Зробив · ✏️ Інша к-сть · ⏰ +10 хв · ❌ Пропустити**.
- Якщо не відповів до наступного нагадування — підхід автоматично позначається «😴 без відповіді».
- 📊 Міні-апп у Telegram:
  - **Статистика** — прогрес за сьогодні, серія днів поспіль, % виконаних нагадувань, графік за 30 днів, теплокарта активності, розподіл по годинах;
  - **Історія** — усі підходи, можна виправити кількість, видалити або додати підхід вручну;
  - **Налаштування** — усе вище без команд.
- Усе можна робити й командами (див. [Команди бота](#команди-бота)). Просто надіслане число записується як підхід.
- Дані лежать у твоїй Google Таблиці — можна дивитися, правити, будувати свої графіки.

## Як це влаштовано

```
                ┌───────────────────────── Cloudflare Worker (*.workers.dev) ─────────────────────────┐
Telegram ──────▶│ /tg     вебхук: одразу відповідає 200, апдейт передає в Apps Script у фоні          │
Міні-апп ──────▶│ /api/*  перевіряє підпис Telegram (initData) і проксіює в Apps Script               │
Користувач ────▶│ /       віддає сам міні-апп (HTML вбудований у worker.js)                           │
Cron (щохв) ───▶│ scheduled → «tick» в Apps Script                                                    │
                └───────────────────────────────────────┬─────────────────────────────────────────────┘
                                                        ▼
                               Google Apps Script (doPost) ──▶ Google Таблиця (аркуші Users, Sets)
                                       │
                                       └──▶ Telegram Bot API (надсилає повідомлення)
```

Навіщо Worker, а не напряму Apps Script? Apps Script на запит Telegram відповідає редиректом `302`, Telegram вважає це помилкою і повторює доставку — бот відповідає по кілька разів або зависає. Worker відповідає Telegram миттєво, дає безкоштовну HTTPS-адресу для міні-аппу і безкоштовний cron.

Worker і Apps Script перевіряють один одного спільним секретом `SECRET`, тож навіть якщо хтось дізнається адресу Apps Script, нічого зробити не зможе.

## Структура репозиторію

```
apps-script/Code.gs      логіка бота: розклад, кнопки, команди, статистика, API, робота з Таблицею
worker/worker.src.js     вихідний код Cloudflare Worker'а
worker/worker.js         ЗГЕНЕРОВАНИЙ файл (worker.src.js + міні-апп) — саме його вставляєш у Cloudflare
webapp/index.html        міні-апп (один HTML-файл, Chart.js з CDN)
scripts/build.mjs        збирає worker/worker.js
tests/harness.mjs        тести з імітацією Google і Telegram (npm test)
wrangler.toml            конфіг для деплою Worker'а з терміналу (необов'язково)
```

---

# 🚀 Налаштування з нуля

Знадобиться: акаунт Telegram, Google-акаунт, безкоштовний акаунт Cloudflare. Близько 15 хвилин.

Порядок важливий: спершу створюємо Worker (щоб знати його адресу), потім Apps Script, потім з'єднуємо їх.

## Крок 1. Створи бота в Telegram

1. Відкрий [@BotFather](https://t.me/BotFather) → `/newbot`.
2. Введи назву (будь-яку) і username (має закінчуватись на `bot`, напр. `my_pushup_bot`).
3. BotFather надішле **токен** виду `1234567890:AAH...`. Збережи його — це `BOT_TOKEN`.
4. Дізнайся свій Telegram id: напиши [@userinfobot](https://t.me/userinfobot) — він відповість числом. Це `ALLOWED_USER_IDS` (щоб ботом не користувались інші).

> ⚠️ Токен — це пароль від бота. Не викладай його в код, скриншоти чи GitHub. Якщо він засвітився — у BotFather зроби `/revoke` і онови його в Apps Script та Cloudflare.

## Крок 2. Створи Cloudflare Worker

1. Зайди на [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** (у меню **Compute**) → **Create**.
2. Обери **Start with Hello World!** (⚠️ **не** «Upload and deploy» / «Drag and drop» — той варіант тільки для статичних файлів і код Worker'а там не запуститься).
3. Назви Worker `pushup-bot` → **Deploy**.
4. Запиши адресу Worker'а, напр. `https://pushup-bot.твій-нік.workers.dev` — це `WEBAPP_URL`.
5. Натисни **Edit code**, видали весь код у редакторі й встав **увесь** вміст файлу [`worker/worker.js`](worker/worker.js) → **Deploy**.

Змінні додамо на кроці 4, коли буде адреса Apps Script.

## Крок 3. Google Таблиця + Apps Script

1. Створи нову [Google Таблицю](https://sheets.new), назви, напр., «Pushups».
2. **Розширення (Extensions) → Apps Script**. Відкриється редактор, прив'язаний до цієї Таблиці.
3. Видали весь код у `Code.gs` і встав вміст файлу [`apps-script/Code.gs`](apps-script/Code.gs). Натисни 💾 (Save).
4. Ліворуч ⚙️ **Project Settings** → внизу **Script Properties** → **Add script property** і додай:

   | Property | Value |
   |---|---|
   | `BOT_TOKEN` | токен із кроку 1 |
   | `WEBAPP_URL` | адреса Worker'а з кроку 2 (**без** `/` у кінці) |
   | `ALLOWED_USER_IDS` | твій Telegram id (кілька — через кому). Порожньо = бот для всіх |
   | `DEFAULT_TZ` | *(необов'язково)* напр. `Europe/Kyiv`. За замовчуванням `Europe/London` |

   → **Save script properties**.
5. Поверніться до редактора (`<>` ліворуч). Угорі у списку функцій обери **`setup`** → **Run**.
   - Google попросить дозвіл: **Review permissions** → обери акаунт → «Google hasn't verified this app» → **Advanced** → **Go to … (unsafe)** → **Allow**. Це твій власний скрипт, тому таке попередження нормальне.
   - У журналі (Execution log) з'явиться рядок
     `🔑 SECRET (встав його у Cloudflare Worker як змінну SECRET): 3f2a…`
     **Скопіюй цей SECRET** — він знадобиться на кроці 4. (Він також збережений у Script Properties.)
   - Далі буде `✅ Готово! Напиши боту /start`. Також у Таблиці з'являться аркуші `Users` і `Sets`.
6. **Deploy → New deployment** → біля «Select type» натисни ⚙️ → **Web app**:
   - **Execute as:** Me
   - **Who has access:** **Anyone** (саме «Anyone», не «Anyone with Google account»)
   - **Deploy** → скопіюй **Web app URL** (закінчується на `/exec`) — це `GAS_URL`.

## Крок 4. Змінні й cron у Worker'і

1. Cloudflare → **Workers & Pages → pushup-bot → Settings**.
2. Блок **Variables and Secrets** → **+ Add** для кожної:

   | Назва | Тип | Значення |
   |---|---|---|
   | `BOT_TOKEN` | Secret | токен бота |
   | `SECRET` | Secret | SECRET із журналу `setup` |
   | `GAS_URL` | Secret або Text | адреса `…/exec` з кроку 3.6 |
   | `ALLOWED_USER_IDS` | Text | твій Telegram id (як в Apps Script) |

   → **Deploy**. Значення вставляй без пробілів і переносів рядка.
3. Там же блок **Trigger Events** (або **Triggers**) → **+ Add → Cron Triggers** → `* * * * *` (щохвилини) → **Add**.

## Крок 5. Перевірка

1. Відкрий у браузері `https://pushup-bot.твій-нік.workers.dev/health` — має бути
   `{"worker":"ok","apps_script":"ok"}`.
2. У Telegram напиши боту `/start` — прийде привітання з налаштуваннями.
3. Напиши `/now` — прийде нагадування з кнопками. Натисни **✅ Зробив** — у Таблиці на аркуші `Sets` з'явиться рядок зі статусом `done`.
4. Закрий і знову відкрий чат з ботом — біля поля вводу буде кнопка **📊 Статистика** (міні-апп).

Готово 🎉 Налаштуй розклад у міні-аппі (вкладка ⚙️) або командами.

---

## Команди бота

| Команда | Що робить |
|---|---|
| `/start` | привітання і поточні налаштування |
| `/stats` | статистика текстом |
| `/settings` | поточні налаштування |
| `/now` | позачергове нагадування зараз |
| `/add 25` | записати підхід вручну (або просто надішли `25`) |
| `/reps 20` | скільки віджимань за раз |
| `/hours 9-21` | проміжок часу (можна `9:30-21:15`) |
| `/every 60` | інтервал у хвилинах (5–720) |
| `/days 12345` | дні тижня: 1 = Пн … 7 = Нд |
| `/tz Europe/Kyiv` | часовий пояс ([список](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)) |
| `/pause`, `/resume` | вимкнути / увімкнути нагадування |

## Як працюють нагадування

- Cron Worker'а щохвилини викликає Apps Script. Той рахує слоти дня: від «з» до «до» з кроком «інтервал», лише у вибрані дні, у твоєму часовому поясі — і надсилає нагадування, коли настав новий слот.
- Якщо система не працювала і слот пропущено більш ніж на 15 хв — старе нагадування не надсилається.
- «⏰ +10 хв» ховає кнопки й через 10 хв надсилає нагадування знову.
- Без відповіді протягом `інтервалу` (мінімум 30 хв, максимум 3 год) → статус `missed`.
- Ціль на день = кількість нагадувань × віджимань за раз. Серія = дні поспіль, коли було хоча б одне віджимання.

## Таблиця (база даних)

**`Users`** — налаштування: `chat_id, reps, start_time, end_time, interval_min, days, tz, enabled, last_slot, created_at`.

**`Sets`** — кожен підхід окремим рядком:

| колонка | значення |
|---|---|
| `local_time` | дата й час у твоєму поясі (`2026-11-19 14:00`) |
| `planned` / `done` | план / скільки зроблено |
| `status` | `done` · `skipped` · `missed` · `pending` |
| `source` | `reminder` (нагадування) або `manual` (вручну) |
| решта | службові поля (UTC-час, id повідомлення тощо) |

Можна будувати свої зведені таблиці й графіки. Правити рядки вручну можна, але не змінюй порядок колонок і заголовки.

---

## 🔄 Оновлення коду

**Apps Script.** Після будь-якої зміни `Code.gs` обов'язково: **Deploy → Manage deployments → ✏️ (Edit) → Version: New version → Deploy**. Інакше адреса `/exec` і далі виконує старий код. Адреса при цьому не змінюється.

**Worker.** Міняєш `worker/worker.src.js` або `webapp/index.html` → `npm run build` → встав новий `worker/worker.js` у редактор Cloudflare → **Deploy** (або `npm run deploy`, див. нижче).

### Деплой Worker'а з терміналу (необов'язково)

```bash
npm i -g wrangler        # або використовуй npx wrangler
wrangler login
npx wrangler secret put BOT_TOKEN
npx wrangler secret put SECRET
npx wrangler secret put GAS_URL
npx wrangler secret put ALLOWED_USER_IDS
npm run deploy           # збирає worker.js і деплоїть разом із cron із wrangler.toml
```

### Розробка й тести

```bash
npm run build   # зібрати worker/worker.js
npm test        # тести: розклад, кнопки, команди, API, перехід на літній час, підпис initData
```
Потрібен лише Node.js 18+, залежностей немає.

---

## 🛠 Якщо щось не працює

| Симптом | Причина і що робити |
|---|---|
| Бот не відповідає взагалі | Відкрий `https://api.telegram.org/bot<ТОКЕН>/getWebhookInfo`. Дивись `url` і `last_error_message`. Або в Apps Script запусти функцію `webhookInfo`. |
| `last_error_message: 404 Not Found`, а в `url` подвійний слеш `…dev//tg` | У `WEBAPP_URL` в кінці стоїть `/`. Прибери його і знову запусти `setup`. |
| `last_error_message: 403` | `SECRET` у Worker'і не збігається з `SECRET` у Script Properties. |
| `/health` → помилка Apps Script | Перевір `GAS_URL` (має закінчуватись на `/exec`) і що в деплої «Who has access: **Anyone**». Також `SECRET` має збігатися. |
| Міні-апп відкривається, але порожній / налаштування порожні | Worker відповідає `401` — неправильний `BOT_TOKEN` у змінних Worker'а (зайвий пробіл, перенос рядка, інша назва). Перевстав його. |
| Міні-апп: «Немає доступу» | Твого id немає в `ALLOWED_USER_IDS` у Worker'і. |
| Змінив код, а бот поводиться по-старому | Не зроблено **New version** у Manage deployments (див. «Оновлення коду»). |
| Немає кнопки «📊 Статистика» | Закрий і знову відкрий чат. Кнопку ставить `setup`, тож запусти його ще раз, якщо міняв `WEBAPP_URL`. |
| Нагадування не приходять | Перевір Cron Trigger у Worker'і (`* * * * *`), що нагадування не на паузі (`/settings`) і що зараз вибраний день і проміжок часу. |
| Cloudflare пише «This uploader does not yet support projects that require a build process» | Ти в режимі «Upload and deploy». Потрібно **Start with Hello World!** → **Edit code** (крок 2). |

**Логи:** Worker → **Logs** (Real-time logs); Apps Script → ліве меню **Executions**.

## Обмеження безкоштовних тарифів

- **Cloudflare Workers Free:** 100 000 запитів на день — бот використовує ~1 500 (cron щохвилини + твої дії).
- **Apps Script (особистий акаунт):** 20 000 запитів `UrlFetch` на день, до 30 одночасних виконань. Для одного-кількох користувачів запас величезний.
- Таблиця з кількома тисячами рядків працює швидко. Якщо `Sets` колись розростеться до десятків тисяч рядків — старі рядки можна перенести на окремий аркуш-архів.

## Безпека

- Секрети (`BOT_TOKEN`, `SECRET`, `GAS_URL`) зберігаються лише в Script Properties та змінних Worker'а — **у коді їх немає**, репозиторій можна робити публічним.
- Вебхук приймається тільки із заголовком `X-Telegram-Bot-Api-Secret-Token`.
- API міні-аппу перевіряє підпис Telegram `initData` (HMAC-SHA256) і `ALLOWED_USER_IDS`.
- Apps Script приймає запити тільки з правильним `SECRET`.
