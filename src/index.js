import 'dotenv/config';
import http from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { createTelegramBot } from './bot.js';
import { query, closePool } from './db.js';
import { getMasterPublicProfileById, getMasterPublicProfileBySlug, renderMasterPublicHtml } from './services/public-pages.js';
import { createBookingFromChannel, getMasterBySlug, listAvailableSlots, listMasterServices } from './services/bookings.js';
import { createPaymentIntentForBooking, markPaymentPaidByBookingId } from './services/payments.js';
import { ensureSlugsForExistingMasters } from './utils/slug.js';
import { startWorkerLoop } from './worker.js';
import { listOutboxDebug } from './services/outbox.js';
import { handleMaxUpdate, verifyMaxWebhook } from './adapters/max.js';
import { sendMaxMessage } from './transports/max.js';
import { ensureDefaultAdmin, authenticateAdmin, createAdminSessionCookie, parseAdminSession, logAdminAction } from './services/admin.js';

const PORT = Number(process.env.PORT || 3000);
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;

async function runStartupMigrations() {
  const migrationsDir = new URL('../migrations/', import.meta.url);
  const files = (await readdir(migrationsDir)).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await query(sql);
  }
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 100_000) reject(new Error('Payload too large')); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function parseFormBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 100_000) reject(new Error('Payload too large'));
    });
    req.on('end', () => resolve(new URLSearchParams(data)));
    req.on('error', reject);
  });
}

async function renderAppPage(slug, errorMessage = '') {
  const master = await getMasterBySlug(slug);
  if (!master) return null;

  const services = await listMasterServices(master.id);
  const slots = await listAvailableSlots(master.id, 20);

  const serviceOptions = services.map((s) => `<option value="${s.id}">${escapeHtml(s.name)} — ${(s.price_cents / 100).toFixed(2)} ₽</option>`).join('');
  const slotOptions = slots.map((s) => `<option value="${s.id}">#${s.id} ${new Date(s.start_at).toLocaleString('ru-RU')}</option>`).join('');

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Запись к ${escapeHtml(master.name)}</title></head><body>
  <main>
    <h1>Онлайн-запись к ${escapeHtml(master.name)}</h1>
    ${errorMessage ? `<p style="color:#b00">${escapeHtml(errorMessage)}</p>` : ''}
    <form method="post" action="/app/m/${encodeURIComponent(slug)}">
      <label>Услуга</label><br/>
      <select name="service_id" required>${serviceOptions}</select><br/><br/>
      <label>Слот</label><br/>
      <select name="slot_id" required>${slotOptions}</select><br/><br/>
      <label>Ваше имя</label><br/>
      <input type="text" name="customer_name" required minlength="2"/><br/><br/>
      <label>Телефон</label><br/>
      <input type="text" name="customer_phone" required placeholder="+79991234567"/><br/><br/>
      <button type="submit">Подтвердить запись</button>
    </form>
    <p><small>Mini App ready: тот же shared booking core будет использован для Telegram WebApp/MAX mini-app.</small></p>
  </main>
</body></html>`;
}

function createHealthServer() {
  return http.createServer(async (req, res) => {
    try {
      if (!req.url) return res.writeHead(400).end('Bad request');
      if (req.url === '/health') return res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ status: 'ok' }));

      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);



      if (req.method === 'GET' && url.pathname === '/admin/login') {
        return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(renderAdminLogin());
      }

      if (req.method === 'POST' && url.pathname === '/admin/login') {
        const form = await parseFormBody(req);
        const user = await authenticateAdmin(String(form.get('username') || ''), String(form.get('password') || ''));
        if (!user) return res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' }).end(renderAdminLogin('Invalid credentials'));
        const cookie = createAdminSessionCookie(user);
        await logAdminAction(user.id, 'admin_login', 'admin_users', String(user.id), {});
        return res.writeHead(302, { location: '/admin', 'set-cookie': cookie }).end();
      }

      if (req.method === 'GET' && url.pathname === '/admin') {
        const admin = requireAdmin(req, res); if (!admin) return;
        const totals = await query(`SELECT (SELECT count(*) FROM masters) AS masters_total,
          (SELECT count(*) FROM masters WHERE is_active = TRUE) AS masters_active,
          (SELECT count(*) FROM outbox_messages WHERE status IN ('pending','failed','processing')) AS outbox_queue,
          (SELECT count(*) FROM outbox_messages WHERE status = 'dead_letter') AS outbox_dead`);
        const recentBookings = await query('SELECT id, booking_status, payment_status, created_at FROM bookings ORDER BY id DESC LIMIT 10');
        const recentPayments = await query('SELECT id, booking_id, status, amount, created_at FROM payments ORDER BY id DESC LIMIT 10');
        return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><html><body><h1>Admin Dashboard</h1><p>Masters: ${totals.rows[0].masters_total} (active ${totals.rows[0].masters_active})</p><p>Outbox queue: ${totals.rows[0].outbox_queue}, dead-letter: ${totals.rows[0].outbox_dead}</p><h2>Recent bookings</h2><ul>${recentBookings.rows.map(b=>`<li><a href="/admin/bookings?id=${b.id}">#${b.id}</a> ${b.booking_status}/${b.payment_status}</li>`).join('')}</ul><h2>Recent payments</h2><ul>${recentPayments.rows.map(p=>`<li>#${p.id} booking ${p.booking_id} ${p.status} ${(p.amount/100).toFixed(2)}₽</li>`).join('')}</ul><p><a href="/admin/masters">Masters</a> | <a href="/admin/bookings">Bookings</a> | <a href="/admin/payments">Payments</a> | <a href="/admin/outbox">Outbox</a></p></body></html>`);
      }

      if (req.method === 'GET' && url.pathname === '/admin/masters') {
        const admin = requireAdmin(req, res); if (!admin) return;
        if (url.searchParams.get('toggle')) {
          const id = Number(url.searchParams.get('toggle'));
          await query('UPDATE masters SET is_active = NOT is_active WHERE id = $1', [id]);
          await logAdminAction(admin.id, 'toggle_master_active', 'masters', String(id), {});
        }
        const masters = await query('SELECT id, name, public_slug, is_active FROM masters ORDER BY id DESC LIMIT 100');
        return res.writeHead(200, {'content-type':'text/html; charset=utf-8'}).end(`<!doctype html><html><body><h1>Masters</h1><ul>${masters.rows.map(m=>`<li>#${m.id} ${escapeHtml(m.name)} [${m.is_active?'active':'inactive'}] <a href="/admin/masters?toggle=${m.id}">toggle</a> <a href="/m/${m.public_slug||''}">public</a></li>`).join('')}</ul><p><a href="/admin">Back</a></p></body></html>`);
      }

      if (req.method === 'GET' && url.pathname === '/admin/bookings') {
        const admin = requireAdmin(req, res); if (!admin) return;
        const status = url.searchParams.get('status');
        const id = url.searchParams.get('id');
        if (id) {
          const b = await query('SELECT * FROM bookings WHERE id = $1', [Number(id)]);
          return res.writeHead(200, {'content-type':'text/html; charset=utf-8'}).end(`<!doctype html><html><body><h1>Booking #${id}</h1><pre>${escapeHtml(JSON.stringify(b.rows[0]||{},null,2))}</pre><p><a href="/admin/bookings">Back</a></p></body></html>`);
        }
        const bookings = status ? await query('SELECT id, booking_status, payment_status, source_channel, created_at FROM bookings WHERE booking_status = $1 ORDER BY id DESC LIMIT 100',[status]) : await query('SELECT id, booking_status, payment_status, source_channel, created_at FROM bookings ORDER BY id DESC LIMIT 100');
        return res.writeHead(200, {'content-type':'text/html; charset=utf-8'}).end(`<!doctype html><html><body><h1>Bookings</h1><p>Filter: <a href="/admin/bookings?status=pending">pending</a> <a href="/admin/bookings?status=confirmed">confirmed</a> <a href="/admin/bookings">all</a></p><ul>${bookings.rows.map(b=>`<li><a href="/admin/bookings?id=${b.id}">#${b.id}</a> ${b.booking_status}/${b.payment_status} ${b.source_channel}</li>`).join('')}</ul><p><a href="/admin">Back</a></p></body></html>`);
      }

      if (req.method === 'GET' && url.pathname === '/admin/payments') {
        const admin = requireAdmin(req, res); if (!admin) return;
        const pays = await query('SELECT id, booking_id, provider, amount, status, created_at FROM payments ORDER BY id DESC LIMIT 100');
        return res.writeHead(200, {'content-type':'text/html; charset=utf-8'}).end(`<!doctype html><html><body><h1>Payments</h1><ul>${pays.rows.map(p=>`<li>#${p.id} booking ${p.booking_id} ${p.provider} ${p.status} ${(p.amount/100).toFixed(2)}₽</li>`).join('')}</ul><p><a href="/admin">Back</a></p></body></html>`);
      }

      if (req.method === 'GET' && url.pathname === '/admin/outbox') {
        const admin = requireAdmin(req, res); if (!admin) return;
        const items = await query('SELECT id, event_type, channel, status, attempt_count, last_error, created_at FROM outbox_messages ORDER BY id DESC LIMIT 100');
        return res.writeHead(200, {'content-type':'text/html; charset=utf-8'}).end(`<!doctype html><html><body><h1>Outbox</h1><ul>${items.rows.map(i=>`<li>#${i.id} ${i.event_type} ${i.channel} ${i.status} attempts=${i.attempt_count} ${escapeHtml(i.last_error||'')}</li>`).join('')}</ul><p><a href="/admin">Back</a></p></body></html>`);
      }

      if (req.method === 'POST' && url.pathname === '/webhooks/max') {
        if (!verifyMaxWebhook(req)) {
          return res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'unauthorized' }));
        }
        const update = await parseJsonBody(req);
        const result = await handleMaxUpdate(update);
        if (result?.reply && update?.user?.id) {
          await sendMaxMessage({ userId: update.user.id, text: result.reply });
        }
        return res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ ok: true }));
      }

      if (req.method === 'GET' && url.pathname.startsWith('/app/m/')) {
        const slug = decodeURIComponent(url.pathname.replace('/app/m/', ''));
        const html = await renderAppPage(slug);
        if (!html) return res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Master not found');
        return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
      }

      if (req.method === 'POST' && url.pathname.startsWith('/app/m/')) {
        const slug = decodeURIComponent(url.pathname.replace('/app/m/', ''));
        const master = await getMasterBySlug(slug);
        if (!master) return res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Master not found');

        const form = await parseFormBody(req);
        const serviceId = Number(form.get('service_id'));
        const slotId = Number(form.get('slot_id'));
        const customerName = String(form.get('customer_name') || '');
        const customerPhone = String(form.get('customer_phone') || '');

        try {
          const booking = await createBookingFromChannel({
            masterId: master.id,
            serviceId,
            slotId,
            customerName,
            customerPhone,
            sourceChannel: 'web',
            clientExternalUserId: `web:${customerPhone}`
          });

          const payment = await createPaymentIntentForBooking(booking.id);
          const payLink = payment.required && payment.paymentUrl
            ? `<p><a href=\"${payment.paymentUrl}\">Оплатить бронирование</a></p>`
            : '<p>Оплата не требуется.</p>';

          return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><html><body><main><h1>Запись подтверждена</h1><p>Booking #${booking.id}</p><p>Статус: ${booking.booking_status}</p><p>${payLink}</p><p><small>Платежный слой готов к подключению реального провайдера через abstraction.</small></p><p><a href=\"/app/m/${encodeURIComponent(slug)}\">Создать ещё запись</a></p></main></body></html>`);
        } catch (error) {
          const html = await renderAppPage(slug, error.message);
          return res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(html);
        }
      }


      if (req.method === 'GET' && url.pathname.startsWith('/pay/mock/')) {
        const bookingId = Number(url.pathname.replace('/pay/mock/', ''));
        if (!Number.isInteger(bookingId) || bookingId <= 0) return res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Invalid booking id');
        await markPaymentPaidByBookingId(bookingId, { provider: 'mock', event: 'paid_via_mock_url' });
        return res.writeHead(302, { location: `/pay/success?bookingId=${bookingId}` }).end();
      }

      if (req.method === 'GET' && url.pathname === '/pay/success') {
        const bookingId = Number(url.searchParams.get('bookingId'));
        return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><html><body><main><h1>Оплата успешно получена</h1><p>Booking #${bookingId || '—'}</p><p>Спасибо! Статус записи обновлён.</p><p><a href="/">На главную</a></p></main></body></html>`);
      }

      if (req.method === 'GET' && url.pathname.startsWith('/m/')) {
        const slug = decodeURIComponent(url.pathname.replace('/m/', ''));
        const profile = await getMasterPublicProfileBySlug(slug);
        if (!profile) return res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Master not found');
        return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(renderMasterPublicHtml(profile, process.env.BASE_URL || ''));
      }

      if (req.method === 'GET' && url.pathname.startsWith('/masters/')) {
        const id = Number(url.pathname.replace('/masters/', ''));
        if (!Number.isInteger(id) || id <= 0) return res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Invalid master id');
        const profile = await getMasterPublicProfileById(id);
        if (!profile) return res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Master not found');
        return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(renderMasterPublicHtml(profile, process.env.BASE_URL || ''));
      }


      if (req.method === 'GET' && url.pathname === '/debug/outbox') {
        const rows = await listOutboxDebug(50);
        return res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(rows));
      }

      return res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'not_found' }));
    } catch (error) {
      return res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(`Internal error: ${error.message}`);
    }
  });
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}



function renderAdminLogin(error = '') {
  return `<!doctype html><html><body><h1>Admin Login</h1>${error ? `<p style="color:red">${escapeHtml(error)}</p>` : ''}<form method="post" action="/admin/login"><input name="username" placeholder="username" required/><br/><input type="password" name="password" placeholder="password" required/><br/><input type="hidden" name="csrf_token" value="dev"/><button type="submit">Login</button></form></body></html>`;
}

function requireAdmin(req, res) {
  const admin = parseAdminSession(req);
  if (!admin) {
    res.writeHead(302, { location: '/admin/login' }).end();
    return null;
  }
  return admin;
}

async function bootstrap() {
  await runStartupMigrations();
  await ensureSlugsForExistingMasters();
  await ensureDefaultAdmin();
  const role = process.env.APP_ROLE || 'all';
  let bot = null;
  let server = null;

  if (role === 'app' || role === 'all') {
    if (!TG_BOT_TOKEN) throw new Error('TG_BOT_TOKEN is required');
    bot = createTelegramBot(TG_BOT_TOKEN);
    bot.start();
    server = createHealthServer();
    server.listen(PORT, () => console.log(`HTTP server listening on :${PORT}`));
  }

  if (role === 'worker' || role === 'all') {
    await startWorkerLoop();
  }

  const shutdown = async () => {
    if (server) server.close();
    if (bot) await bot.stop();
    await closePool();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((error) => {
  console.error('Startup failed', error);
  process.exit(1);
});
