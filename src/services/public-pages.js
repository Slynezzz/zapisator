import { query } from '../db.js';

export async function getMasterPublicProfileBySlug(slug) {
  const masterRes = await query(
    `SELECT id, name, public_slug, specialization, city, phone
     FROM masters
     WHERE public_slug = $1
     LIMIT 1`,
    [slug]
  );
  const master = masterRes.rows[0];
  if (!master) return null;

  return buildPublicProfile(master);
}

export async function getMasterPublicProfileById(id) {
  const masterRes = await query(
    `SELECT id, name, public_slug, specialization, city, phone
     FROM masters
     WHERE id = $1
     LIMIT 1`,
    [id]
  );
  const master = masterRes.rows[0];
  if (!master) return null;

  return buildPublicProfile(master);
}

async function buildPublicProfile(master) {
  const servicesRes = await query(
    `SELECT id, name, duration_minutes, price_cents
     FROM master_services
     WHERE master_id = $1 AND is_active = TRUE
     ORDER BY id ASC`,
    [master.id]
  );

  const slotsRes = await query(
    `SELECT id, start_at, end_at
     FROM master_slots
     WHERE master_id = $1
       AND status = 'available'
       AND start_at >= now()
     ORDER BY start_at ASC
     LIMIT 20`,
    [master.id]
  );

  return {
    master,
    services: servicesRes.rows,
    slots: slotsRes.rows
  };
}

export function renderMasterPublicHtml(profile, baseUrl = '') {
  const { master, services, slots } = profile;
  const bookingLink = `/app/m/${master.public_slug || master.id}`;
  const tgLink = process.env.TG_BOT_USERNAME ? `https://t.me/${process.env.TG_BOT_USERNAME}` : null;
  const miniAppLink = `/app/m/${master.public_slug || master.id}`;

  const serviceItems = services.length
    ? services
        .map((service) => `<li>${escapeHtml(service.name)} — ${(service.price_cents / 100).toFixed(2)} ₽, ${service.duration_minutes} мин</li>`)
        .join('')
    : '<li>Пока нет активных услуг</li>';

  const slotItems = slots.length
    ? slots
        .map((slot) => `<li>#${slot.id} ${new Date(slot.start_at).toLocaleString('ru-RU')} — ${new Date(slot.end_at).toLocaleTimeString('ru-RU')}</li>`)
        .join('')
    : '<li>Нет ближайших доступных слотов</li>';

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(master.name)} — Записатор</title>
</head>
<body>
  <main>
    <h1>${escapeHtml(master.name)}</h1>
    <p><strong>Специализация:</strong> ${escapeHtml(master.specialization || 'не указана')}</p>
    <p><strong>Город:</strong> ${escapeHtml(master.city || 'не указан')}</p>
    ${master.phone ? `<p><strong>Телефон:</strong> ${escapeHtml(master.phone)}</p>` : ''}

    <h2>Услуги</h2>
    <ul>${serviceItems}</ul>

    <h2>Ближайшие слоты</h2>
    <ul>${slotItems}</ul>

    <p><a href="${bookingLink}">Открыть запись</a></p>
    ${tgLink ? `<p><a href="${tgLink}">Открыть Telegram-бота</a></p>` : ''}
    <p><a href="${miniAppLink}">Открыть Mini App (скоро)</a></p>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
