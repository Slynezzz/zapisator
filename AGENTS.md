# AGENTS.md — Записатор / MasterSlot

> Этот файл предназначен для OpenAI Codex и любого AI-агента, работающего с кодовой базой проекта.
> Читай его полностью перед любым действием с кодом.

---

## 1. Что это за проект

**Записатор / MasterSlot** — мультиканальный B2B SaaS-сервис онлайн-записи для частных специалистов и микро-команд (мастера маникюра, барберы, репетиторы, массажисты, косметологи, тренеры и др.).

Сервис работает одновременно в:
- **Telegram** (grammy бот + Mini App / Web App)
- **MAX** (VK-мессенджер, аналогичная схема: бот + mini-app)
- **Web** (публичная страница мастера, web booking, admin panel)

Ключевое позиционирование: «Личный цифровой офис для одного мастера. Без сайта, без CRM, за 5 минут». Это не замена YCLIENTS — это инструмент для тех, кто сейчас ведёт запись в WhatsApp и тетради.

---

## 2. Роли и ответственности

| Роль | Кто |
|---|---|
| Продуктовый архитектор / владелец | Максим (проектирует, тестирует, принимает решения) |
| Технический исполнитель | AI-агент (ты) |

**Максим не пишет код.** Ты пишешь код, проектируешь, предлагаешь решения. Максим проверяет бизнес-логику и тестирует как пользователь.

---

## 3. Стек и инфраструктура

### Обязательный стек
```
Node.js 20+      ESM modules (import/export, НЕ require/CommonJS)
PostgreSQL        pg (не ORM, только чистые SQL-запросы через pg)
grammy            Telegram Bot API
dotenv            ENV переменные
встроенный HTTP   Node.js http server (не Express, не Fastify по умолчанию)
MAX adapter       HTTPS API (собственный адаптер, не сторонняя библиотека)
```

### Инфраструктура
- **Деплой:** Railway (app process + worker process)
- **БД:** PostgreSQL (Railway managed или Yandex Cloud)
- **Хранилище файлов:** Yandex Object Storage (S3-совместимый)
- **Платежи:** YooKassa (основной), Tinkoff (опционально), СБП
- **AI:** OpenAI API (text: gpt-4o, embeddings), YandexGPT (опционально)
- **CI:** GitHub Actions

### Запрещённые технологии (без явного согласования с Максимом)
```
❌ Redis / любой внешний брокер очередей
❌ Kubernetes, Docker Swarm
❌ Микросервисная архитектура
❌ Тяжёлые ORM (Prisma, TypeORM, Sequelize)
❌ Express, Fastify (если сервер уже написан на встроенном HTTP — не мигрировать)
❌ TypeScript (проект на чистом JS ESM)
❌ require() / CommonJS
```

---

## 4. Архитектурная модель: Unified Core + Channel Adapters

**Главный принцип:** Telegram и MAX — это не два разных продукта. Это два channel adapter поверх одного доменного ядра.

```
┌─────────────────────────────────────────────┐
│               DOMAIN CORE                   │
│  masters · services · slots · bookings      │
│  customers · payments · reviews · support   │
│  notifications · ai · analytics             │
└──────┬──────────────────────────────┬───────┘
       │                              │
┌──────▼───────┐              ┌───────▼──────┐
│  Telegram    │              │    MAX       │
│  adapter     │              │   adapter   │
│  (grammy)    │              │ (HTTPS API) │
└──────────────┘              └─────────────┘
       │                              │
┌──────▼──────────────────────────────▼──────┐
│              WEB LAYER                      │
│  /m/:slug · /app/m/:slug · /admin · /api   │
└─────────────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────┐
│           BACKGROUND LAYER                  │
│   outbox · reminders · slot generation      │
│   maintenance · dead-letter worker          │
└─────────────────────────────────────────────┘
```

### Критические архитектурные инварианты (НЕЛЬЗЯ нарушать)

1. **Telegram и MAX имеют ОДИНАКОВУЮ бизнес-логику.** Различаются только: UI-тексты, форматы кнопок, callback payload, особенности Mini App запуска. Разная доменная логика — это баг.

2. **Уведомления только через outbox.** Никогда не отправлять сообщение из HTTP request handler напрямую. Всегда: request → запись intent в `outbox_messages` → worker читает и доставляет.

3. **Webhook-и идемпотентны.** Таблица `webhook_events` с UNIQUE(provider, event_key). Повторный webhook не создаёт дублей.

4. **Booking создаётся первым, payment intent — вторым.** Статус booking обновляется только после reconciliation с реальным статусом платежа от провайдера.

5. **Slot reservation — атомарно в транзакции** (`FOR UPDATE`). Никогда не резервировать слот вне транзакции.

6. **public_reviews и private_customer_feedback — отдельные таблицы.** Нельзя объединять. Разные права доступа. Клиент НЕ видит `private_customer_feedback` никогда.

7. **AI-слой отдельно.** Весь AI-код живёт в `src/ai/`. Никакого AI-кода внутри handlers, services или db-запросов.

8. **Миграции только в одну сторону** (`IF NOT EXISTS`, никогда `DROP`). Новая функциональность — новый файл миграции с номером по порядку.

---

## 5. Структура проекта

```
masterslot/
├── src/
│   ├── index.js              ← точка входа; APP_ROLE=app|worker|all
│   ├── app.js                ← HTTP ingress: Telegram webhook/polling, MAX, YooKassa webhooks
│   ├── worker.js             ← reminders + outbox delivery loop
│   ├── server.js             ← HTTP роутер: public pages, web-booking, admin, webhooks
│   ├── bot.js                ← grammy роутинг (callbacks, regex для master/service/slot)
│   ├── config.js             ← ENV переменные (dotenv)
│   ├── db.js                 ← PostgreSQL клиент pg, query(), транзакции, advisory lock, schema_migrations
│   │
│   ├── handlers/             ← grammy handlers (тонкий слой, делегирует в services)
│   │   ├── start.js
│   │   ├── register.js
│   │   ├── booking.js
│   │   ├── services.js
│   │   ├── slots.js
│   │   └── ...
│   │
│   ├── services/             ← доменная логика (бизнес-правила здесь)
│   │   ├── masters.js
│   │   ├── bookings.js
│   │   ├── services.js       (услуги мастера)
│   │   ├── slots.js
│   │   ├── customers.js
│   │   ├── payments.js
│   │   ├── outbox.js
│   │   ├── reminders.js
│   │   ├── webhooks.js
│   │   ├── security.js
│   │   ├── rate-limit.js
│   │   ├── admin.js
│   │   ├── channels.js
│   │   ├── inbound.js
│   │   ├── max-adapter.js
│   │   ├── booking-notifications.js
│   │   ├── maintenance.js
│   │   ├── reviews.js          ← Phase 3
│   │   ├── private-feedback.js ← Phase 3
│   │   ├── support.js          ← Phase 3
│   │   └── app-settings.js     ← Phase 3
│   │
│   ├── api/
│   │   └── v1/
│   │       ├── index.js      ← регистрирует все route-модули
│   │       ├── auth.js
│   │       ├── master.js
│   │       ├── public.js
│   │       ├── customer.js
│   │       ├── reviews.js      ← Phase 3
│   │       ├── support.js      ← Phase 3
│   │       └── admin.js
│   │
│   ├── payments/
│   │   ├── registry.js       ← реестр провайдеров
│   │   └── providers/
│   │       ├── yookassa.js
│   │       ├── tinkoff.js    (skeleton)
│   │       └── mock.js
│   │
│   ├── ai/                   ← AI-слой (отдельный, не мешать с остальным)
│   │   ├── prompts/
│   │   ├── providers/
│   │   │   └── openai.js
│   │   ├── use-cases/
│   │   │   ├── generate-bio.js
│   │   │   ├── suggest-services.js
│   │   │   ├── classify-ticket.js
│   │   │   └── summarize-support.js
│   │   ├── policies/
│   │   └── audit/
│   │
│   ├── utils/
│   │   ├── time.js           ← TZ-aware helpers
│   │   ├── passwords.js      ← PBKDF2
│   │   ├── webhook-keys.js   ← composite event keys
│   │   ├── max-normalize.js  ← pure normalizer для MAX payload
│   │   └── constants.js      ← BOOKING_STATUS, ADMIN_ROLES, ...
│   │
│   └── scripts/
│       ├── createAdmin.js    ← CLI: создание admin-пользователя
│       ├── migrate.js        ← standalone migration runner
│       └── maintenance/
│
├── migrations/               ← SQL миграции, нумерация 001, 002, ...
│   ├── 001_init.sql
│   ├── 002_mvp.sql
│   ├── 003_payments.sql
│   ├── 004_public_pages.sql
│   ├── 005_admin_ops.sql
│   ├── 006_multi_channel.sql
│   ├── 007_hardening.sql
│   ├── 008_outbox.sql
│   ├── 009_phase1_fixes.sql
│   ├── 010_phase2.sql
│   └── 011_phase3_reviews_support_ai.sql  ← в разработке
│
├── miniapp/
│   └── public/
│       ├── index.html
│       ├── app.js            ← SPA роутер
│       ├── api.js            ← клиент к API v1
│       └── views/
│           ├── master-cabinet.js
│           ├── client-booking.js
│           ├── my-bookings.js
│           ├── reviews.js      ← Phase 3
│           └── support.js      ← Phase 3
│
├── tests/
│   ├── unit/
│   │   ├── time.test.js
│   │   ├── auth.test.js
│   │   ├── max-normalize.test.js
│   │   ├── webhooks-event-key.test.js
│   │   ├── bookings-duration.test.js
│   │   ├── security.test.js
│   │   ├── phones.test.js
│   │   ├── router.test.js
│   │   ├── payments-registry.test.js
│   │   ├── tariffs.test.js
│   │   └── ai-registry.test.js
│   └── integration/
│       └── ...
│
├── .github/
│   └── workflows/
│       └── ci.yml
│
├── .env.example
├── .gitignore
├── package.json              ← "type": "module", Node.js 20+
├── railway.json
├── Dockerfile
├── docker-compose.yml
└── nginx.conf
```

---

## 6. База данных: сущности и таблицы

### Все таблицы (включая Phase 3)

```sql
-- Ядро
masters                    -- мастера, профили, slug, тарифы
master_services            -- услуги мастера (название, цена, длительность, предоплата)
working_hours              -- шаблон рабочего времени
master_slots               -- конкретные слоты (generated + manual)
customers                  -- клиенты (tg_user_id, max_user_id, телефон, blacklist)
bookings                   -- записи (статусы, привязки, аудит)
payments                   -- платежи (provider, idempotency_key, reconciliation)

-- Каналы и состояния
user_states                -- FSM-состояния диалога (tg_user_id, state, data JSON)
channel_user_states        -- состояния по каналу (channel + external_user_id)
webhook_events             -- UNIQUE(provider, event_key) для идемпотентности

-- Фоновые задачи
outbox_messages            -- очередь уведомлений (dedupe_key, payload, status)
outbox_attempts            -- история попыток доставки (retry, dead-letter)

-- Административная часть
admin_users                -- RBAC: super_admin / admin / support / readonly
admin_login_attempts       -- throttling для admin login
admin_audit_logs           -- каждое admin-действие с entity

-- Настройки и шаблоны
app_settings               -- key-value настройки через UI (без деплоя)
app_settings_history       -- аудит изменений настроек
message_templates          -- шаблоны уведомлений, управляемые через UI
tariffs                    -- тарифные планы и лимиты
promotions                 -- промокоды
waitlist                   -- лист ожидания

-- Phase 3: Отзывы и репутация
public_reviews             -- публичные отзывы клиентов о мастерах
                           -- UNIQUE(booking_id) — один booking = один отзыв
                           -- moderation_status: pending / approved / hidden
private_customer_feedback  -- ЗАКРЫТЫЕ отзывы мастеров о клиентах
                           -- visibility_scope: master_only / studio
                           -- КЛИЕНТ НИКОГДА НЕ ВИДИТ ЭТУ ТАБЛИЦУ

-- Phase 3: Поддержка
support_tickets            -- тикеты (type, status, linked entity)
support_ticket_messages    -- переписка по тикету (двусторонняя)

-- Phase 3: AI
ai_tasks                   -- задачи AI (type, payload, status, result)
ai_suggestions             -- предложения AI (accepted/rejected, entity)
ai_audit_logs              -- полный аудит AI вызовов (prompt, result, model)

-- Прочее
attachments                -- файлы (S3 ключи, привязка к entity)
```

### Статусы booking (CHECK constraint)
```
pending → awaiting_payment → paid → confirmed → completed
                                              ↘ cancelled
                                              ↘ no_show
                                              ↘ rescheduled
```

### Статусы outbox
```
pending → processing → delivered
                    ↘ failed → (retry) → dead_letter
```

---

## 7. API v1: список эндпоинтов

```
POST /api/v1/auth/session          ← создать сессию (master auth)
POST /api/v1/auth/logout

GET  /api/v1/master/profile        ← кабинет мастера
PUT  /api/v1/master/profile
GET  /api/v1/master/services
POST /api/v1/master/services
PUT  /api/v1/master/services/:id
DEL  /api/v1/master/services/:id
GET  /api/v1/master/working-hours
PUT  /api/v1/master/working-hours
GET  /api/v1/master/slots
POST /api/v1/master/slots
DEL  /api/v1/master/slots/:id
GET  /api/v1/master/bookings
GET  /api/v1/master/customers

GET  /api/v1/public/master/:slug            ← без авторизации
GET  /api/v1/public/master/:slug/services
GET  /api/v1/public/master/:slug/slots

POST /api/v1/customer/bookings              ← клиентская запись
GET  /api/v1/customer/bookings
POST /api/v1/customer/bookings/:id/cancel

-- Phase 3
GET  /api/v1/master/reviews
GET  /api/v1/master/private-feedback/tags
POST /api/v1/master/customers/:id/feedback
GET  /api/v1/master/customers/:id/feedback
GET  /api/v1/public/master/:slug/reviews

GET  /api/v1/customer/reviews
GET  /api/v1/customer/reviews/eligible
POST /api/v1/customer/reviews

GET  /api/v1/support/tickets
GET  /api/v1/support/tickets/:id
POST /api/v1/support/tickets
POST /api/v1/support/tickets/:id/messages

POST /api/v1/master/ai/generate-bio
POST /api/v1/master/ai/suggest-services
POST /api/v1/master/ai/suggestions/:id/accept
POST /api/v1/master/ai/suggestions/:id/reject
```

---

## 8. Текущий статус разработки

### Phase 1 — Core MVP ✅
- Регистрация мастера (Telegram + MAX wizard)
- Услуги, расписание, слоты
- Бронирования, отмена, перенос
- Публичная страница мастера `/m/:slug`
- Web booking flow `/app/m/:slug`
- Admin panel (login, dashboard, masters, bookings, reminders, audit, outbox)
- Payment abstraction (mock + YooKassa skeleton)
- Outbox + reminders workers
- Тесты: 65/65 unit

### Phase 2 — Payments + Mini-app ✅
- Customer self-service в боте (`/my`, `/мои`, inline кнопки)
- Mini-app: 3 экрана (master cabinet 5 табов + client booking 3 шага + my bookings)
- API v1: 27 эндпоинтов
- Централизованный booking-notifications сервис
- YooKassa Маркетплейс (split-payment, createSplitIntent — архитектурно готов)
- Тарифная сетка: free / basic / pro / team / business
- Working-hours отдельно от slots, автогенерация
- Тесты: +38, итого 103/103 unit

### Phase 3 — Reviews, Support, AI ⏳ В РАЗРАБОТКЕ
- Migration 011: public_reviews, private_customer_feedback, support_tickets, support_ticket_messages, ai_tasks, ai_suggestions, ai_audit_logs
- Services: reviews, private-feedback, support, app-settings, message-templates
- API routes: reviews, support, admin расширение
- Mini-app views: reviews, support
- AI use-cases P0: generate-bio, suggest-services, classify-ticket, summarize-support
- Worker: auto-complete bookings, review request cycle, daily slot generation

### Phase 4 — Production Hardening (запланировано)
- Split-payment активация (YooKassa Маркетплейс live)
- Recurring subscriptions
- 2FA TOTP для супер-админа
- RBAC полный (сейчас single-admin)
- timezone normalization (сейчас заготовка)

---

## 9. Известные пробелы (из RISK_REGISTER)

| Пробел | Статус | Приоритет |
|---|---|---|
| MAX adapter не проверен живым smoke-тестом | Архитектурно готов, нормализация протестирована, live — нет | High |
| YooKassa: нет refund/cancel | Skeleton есть, production flow — нет | High |
| Single-admin, нет RBAC | Таблица admin_users есть, RBAC не реализован | Medium |
| In-process worker (нет внешнего брокера) | Осознанное решение, мониторить при росте нагрузки | Low |
| Timezone normalization | Заготовка в time.js, не везде применена | Medium |
| Фото/портфолио мастера | Архитектурно предусмотрено (attachments), не реализовано | Low |

---

## 10. Монетизация (важно для бизнес-логики)

```
Free      → 2% комиссия со всех платежей через платформу; лимиты на функционал
Basic     → фиксированная подписка, базовые лимиты сняты
Pro       → 490₽/мес или аналог; advanced функции; логика: при обороте >24 500₽/мес выгоднее подписки
Team      → несколько мастеров, общий аккаунт студии
Business  → корпоративный тариф

Логика конверсии: free master при обороте >24 500₽/мес получает сигнал что Pro выгоднее комиссии
```

Тарифные ограничения управляются через `tariffs` таблицу и `app_settings` — **без деплоя**.

---

## 11. Бизнес-правила, которые нельзя нарушать

1. **Один completed booking = максимум один public_review.** Таблица имеет `UNIQUE(booking_id)`.

2. **private_customer_feedback** видят только: сам мастер, его студия (если разрешено ролью), admin. Клиент не видит. Никогда. Ни при каких условиях. Это отдельная таблица, не поле в public_reviews.

3. **Support ticket** — это не отзыв. Отдельная сущность, отдельный UI, отдельная таблица.

4. **AI не принимает критические решения самостоятельно.** AI может: предлагать, суммировать, классифицировать, генерировать текст. AI не может: отменять записи, менять цены, списывать деньги, удалять данные.

5. **Все AI-действия логируются** в `ai_audit_logs`. Все AI use-cases отключаемы через `app_settings` feature flag.

6. **Booking flow атомарен.** Создание booking + резервирование слота — в одной транзакции с `FOR UPDATE`.

7. **Webhook идемпотентен.** Первая вставка в `webhook_events` (UNIQUE constraint) — success. Повтор — игнорировать, не обрабатывать повторно.

8. **Все уведомления через outbox.** Ни один HTTP request handler не должен вызывать bot.sendMessage/MAX API напрямую.

---

## 12. Правила написания кода

### Обязательно
```javascript
// ESM everywhere
import { query } from '../db.js';
import { createBooking } from '../services/bookings.js';

// Расширения файлов в импортах обязательны
import { foo } from './bar.js'; // ✅
import { foo } from './bar';    // ❌

// Транзакции через withTransaction или явный BEGIN/COMMIT/ROLLBACK
const result = await withTransaction(async (client) => {
  // ...
});

// Все ошибки логировать структурно
logger.error('Booking creation failed', { bookingId, error: err.message, stack: err.stack });
```

### Запрещено
```javascript
// ❌ CommonJS
const { query } = require('../db');

// ❌ Прямая отправка уведомлений из handlers
await bot.sendMessage(userId, text); // в HTTP handler или в доменном сервисе

// ❌ Бизнес-логика, специфичная для одного канала
if (channel === 'telegram') {
  // делаем что-то с booking иначе, чем для max
}

// ❌ DROP в миграциях
DROP TABLE bookings; // НИКОГДА

// ❌ Хардкод тарифных лимитов
if (bookings.length >= 10) { // ❌ — берётся из tariffs таблицы
```

### Стиль
- Функции — короткие, с одной ответственностью
- Имена — говорящие, без сокращений (кроме устоявшихся: `id`, `db`, `ctx`)
- Комментарии на русском или английском — без разницы, главное точность
- `console.log` в production коде — только через обёртку `logger`

---

## 13. Тестирование

### Статус тестов
- **103/103 unit-тестов** проходят (`node --test tests/unit/*.test.js`)
- Integration/E2E тесты требуют живой БД и окружения

### Правила
- **Новый модуль → новый test file** в `tests/unit/`
- **Каждая новая миграция** → migration smoke test
- **Webhook handlers** → fixture tests (отдельный файл с mock payloads)
- **Перед commit** — `npm run test:unit` должен проходить полностью
- **Перед production deploy** — `npm run ci` на staging (unit + integration)

### Команды
```bash
npm run test:unit          # только unit
npm run test:integration   # требует БД
npm run ci                 # полный пайплайн
node --test tests/unit/bookings-duration.test.js  # один файл
```

### Что тестировать в первую очередь
1. Чистые утилиты (time.js, passwords.js, webhook-keys.js) — без зависимостей
2. Бизнес-правила (duration calc, status transitions, tariff logic)
3. MAX normalizer (pure function, легко тестировать)
4. Security helpers (initData validation, CSRF)
5. Payment registry (моки провайдеров)

---

## 14. Переменные окружения (.env.example)

```env
# App
NODE_ENV=development
APP_ROLE=all               # app | worker | all
PORT=3000
BASE_URL=https://your-domain.com

# Telegram
TG_BOT_TOKEN=
TG_WEBHOOK_SECRET=

# MAX
MAX_BOT_TOKEN=
MAX_WEBHOOK_SECRET=
MAX_API_URL=https://botapi.max.ru

# PostgreSQL
DATABASE_URL=postgresql://user:pass@host:5432/masterslot

# YooKassa
YOOKASSA_SHOP_ID=
YOOKASSA_SECRET_KEY=
YOOKASSA_MARKETPLACE_AGENT_ID=   # для split-payment

# Tinkoff (опционально)
TINKOFF_TERMINAL_KEY=
TINKOFF_SECRET_KEY=

# Yandex S3
S3_BUCKET=
S3_KEY_ID=
S3_SECRET_KEY=
S3_ENDPOINT=https://storage.yandexcloud.net

# OpenAI
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o

# Admin
ADMIN_USERNAME=              # bootstrap (legacy, создаёт запись в admin_users)
ADMIN_PASSWORD=
SESSION_SECRET=              # 32+ символа случайная строка

# Security
CSRF_SECRET=
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_PUBLIC=60
RATE_LIMIT_MAX_ADMIN=30
```

---

## 15. Deployment

### Процессы
```bash
APP_ROLE=app     node src/index.js   # HTTP + Telegram/MAX webhook ingress
APP_ROLE=worker  node src/index.js   # reminders + outbox + maintenance
APP_ROLE=all     node src/index.js   # оба (для dev/single-dyno)
```

### Railway
```json
// railway.json
{
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "startCommand": "node src/index.js",
    "healthcheckPath": "/health"
  }
}
```

### Health endpoints
```
GET /health        → 200 { status: "ok", role, uptime }
GET /ready         → 200 | 503 (если БД недоступна)
```

### Migrations
```bash
node src/scripts/migrate.js   # применяет все pending миграции
```
Миграции применяются автоматически при старте app process.

---

## 16. Правила для AI-агента при работе с кодом

### Перед любым изменением
1. Прочитай этот файл целиком (ты сейчас это делаешь)
2. Поймите текущий статус фазы разработки (раздел 8)
3. Проверь, не нарушает ли изменение инварианты из раздела 7

### При создании новой функциональности
1. Сначала — миграция (если нужна), файл: `migrations/0NN_description.sql`
2. Сначала — domain service в `src/services/`
3. Потом — API route в `src/api/v1/`
4. Потом — bot handlers в `src/handlers/`
5. Потом — mini-app view в `miniapp/public/views/`
6. Последним — тесты в `tests/unit/`

### При изменении существующего кода
- Не переписывать работающий код без явной задачи на рефакторинг
- Backward compatibility обязательна для API эндпоинтов
- Все миграции только аддитивные (`ALTER TABLE ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`)

### Когда остановиться и спросить Максима
- Изменение бизнес-правил тарификации или монетизации
- Добавление новой внешней зависимости в package.json
- Изменение схемы данных, которое может потерять существующие данные
- Любое изменение платёжного флоу
- Изменение прав доступа к private_customer_feedback
- Добавление AI-функции, которая может принимать действия без подтверждения пользователя

---

## 17. Глоссарий проекта

| Термин | Значение |
|---|---|
| Мастер | Специалист, зарегистрированный в сервисе (предоставляет услуги) |
| Клиент | Человек, который записывается к мастеру |
| Slug | Уникальный URL-идентификатор мастера (`/m/elena-manikyur`) |
| Slot | Конкретный временной слот (дата + время начала + длительность) |
| Booking | Запись клиента на конкретный slot + service |
| Outbox | Паттерн надёжной доставки уведомлений через отдельную таблицу + worker |
| Channel | Telegram или MAX (не telegram-канал/чат) |
| Adapter | Слой адаптации channel-специфики к единому доменному ядру |
| public_reviews | Публичные отзывы клиентов о мастерах (видны всем) |
| private_customer_feedback | Закрытые отзывы мастеров о клиентах (клиент не видит) |
| support_tickets | Обращения в платформу (не путать с отзывами) |
| App settings | Настройки платформы, управляемые через UI (без деплоя) |
| Feature flag | Флаг включения/выключения функции через app_settings |
| Dead-letter | Сообщения в outbox, исчерпавшие все retry-попытки |
| Split-payment | YooKassa Маркетплейс: автоматическое разделение платежа мастер/платформа |

---

## 18. Донорские кодовые базы (для референса)

При необходимости можно ориентироваться на паттерны из:
- `@myaicook_bot` — manifest-driven архитектура, grammy + PostgreSQL + YooKassa, Node.js ESM, Railway деплой. Это самый близкий аналог по стеку.
- `myplanlife` — grammy + YooKassa + Tinkoff, manifest-driven.

**Важно:** это не copy-paste источники. Это референсы для архитектурных паттернов. Бизнес-логика Записатора значительно сложнее обоих.

---

## Code organization rules

- Do not place large amounts of unrelated logic in index.js, app.js, worker.js, bot.js, or server.js.
- Keep entry files thin.
- Put business logic in src/domain/*/service.js.
- Put database access in src/domain/*/repo.js or src/db/*.
- Keep Telegram and MAX adapters thin and channel-specific.
- Keep admin/public/miniapp routes separate under src/web/.
- Prefer splitting files over creating giant multi-responsibility modules.
- Every change should preserve modularity and future maintainability.

---

*Последнее обновление: апрель 2026. Актуальный статус: Phase 2 завершена, Phase 3 в разработке.*
