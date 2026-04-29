# Zapisator — shared core skeleton

## Channels
- Telegram adapter (bot handlers)
- MAX adapter (`src/adapters/max.js`) via webhook `POST /webhooks/max`
- Shared business core in services (bookings/payments/schedule/outbox)

## Routes
- `GET /health`
- `POST /webhooks/max`
- `GET /m/:slug`
- `GET /masters/:id`
- `GET /app/m/:slug`
- `POST /app/m/:slug`
- `GET /pay/mock/:bookingId`
- `GET /pay/success`
- `GET /debug/outbox`

## MAX setup
- Set `MAX_BOT_TOKEN`, `MAX_WEBHOOK_SECRET`, `MAX_API_URL`.
- Webhook secret is verified via `x-max-webhook-secret`.
- Payload parsing is isolated in MAX adapter.
- MAX flow currently supports: start, master registration, list masters, link to app surface.

## Worker/outbox
- `APP_ROLE=app|worker|all`
- Outbox remains shared for all channels.
- Notification transport abstraction: `src/services/channels.js`.


## Admin panel
- Routes: /admin/login, /admin, /admin/masters, /admin/bookings, /admin/payments, /admin/outbox
- Uses signed cookie session (`SESSION_SECRET`) and bootstrap admin from env (`ADMIN_USERNAME`, `ADMIN_PASSWORD`).
- Admin actions are audited in `admin_audit_logs`.
