import { query } from '../db.js';
import { listMasters } from '../services/bookings.js';

const REG_STATE = 'waiting_master_name';

export function verifyMaxWebhook(req) {
  const secret = req.headers['x-max-webhook-secret'];
  return Boolean(process.env.MAX_WEBHOOK_SECRET) && secret === process.env.MAX_WEBHOOK_SECRET;
}

export async function handleMaxUpdate(update) {
  const userId = String(update?.user?.id || '');
  const text = String(update?.text || '').trim();
  if (!userId || !text) return { reply: null };

  if (text === '/start' || text.toLowerCase() === 'start') {
    await setState(userId, 'idle', {});
    return { reply: 'Добро пожаловать в Записатор (MAX). Команды: register, masters, app' };
  }

  if (text.toLowerCase() === 'register') {
    await setState(userId, REG_STATE, {});
    return { reply: 'Введите ваше имя как мастера.' };
  }

  const state = await getState(userId);
  if (state === REG_STATE) {
    const masterRes = await query(
      `INSERT INTO masters (name, tg_user_id)
       VALUES ($1, $2)
       ON CONFLICT (tg_user_id)
       DO UPDATE SET name = EXCLUDED.name, updated_at = now()
       RETURNING id`,
      [text, `max:${userId}`]
    );
    await setState(userId, 'registered', {});
    return { reply: `Регистрация завершена. ID мастера: ${masterRes.rows[0].id}` };
  }

  if (text.toLowerCase() === 'masters') {
    const masters = await listMasters();
    if (!masters.length) return { reply: 'Пока нет мастеров.' };
    return { reply: masters.map((m) => `${m.id}: ${m.name}`).join('\n') };
  }

  if (text.toLowerCase() === 'app') {
    const base = process.env.BASE_URL || '';
    return { reply: `Откройте mini-app/web: ${base}/app/m/demo` };
  }

  return { reply: 'Не понял команду. Используйте: register, masters, app' };
}

async function setState(userId, state, data) {
  await query(
    `INSERT INTO channel_user_states (channel, external_user_id, state, data)
     VALUES ('max', $1, $2, $3::jsonb)
     ON CONFLICT (channel, external_user_id)
     DO UPDATE SET state = EXCLUDED.state, data = EXCLUDED.data, updated_at = now()`,
    [userId, state, JSON.stringify(data)]
  );
}

async function getState(userId) {
  const res = await query('SELECT state FROM channel_user_states WHERE channel = $1 AND external_user_id = $2', ['max', userId]);
  return res.rows[0]?.state || null;
}
