import { query } from '../db.js';
import { ensureUniqueMasterSlug } from '../utils/slug.js';

const STATE_WAITING_MASTER_NAME = 'waiting_master_name';

export async function startRegistration(ctx) {
  const tgUserId = String(ctx.from?.id ?? '');
  if (!tgUserId) return;

  await query(
    `INSERT INTO user_states (tg_user_id, state, data)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (tg_user_id)
     DO UPDATE SET state = EXCLUDED.state, data = EXCLUDED.data, updated_at = now()`,
    [tgUserId, STATE_WAITING_MASTER_NAME, JSON.stringify({ step: 'name' })]
  );

  await ctx.reply('Введите ваше имя как мастера.');
}

export async function handleRegistrationInput(ctx) {
  const tgUserId = String(ctx.from?.id ?? '');
  const text = ctx.message?.text?.trim();

  if (!tgUserId || !text) return false;

  const stateRes = await query('SELECT state FROM user_states WHERE tg_user_id = $1', [tgUserId]);
  const state = stateRes.rows[0]?.state;

  if (state !== STATE_WAITING_MASTER_NAME) return false;

  const masterRes = await query(
    `INSERT INTO masters (tg_user_id, name)
     VALUES ($1, $2)
     ON CONFLICT (tg_user_id)
     DO UPDATE SET name = EXCLUDED.name, updated_at = now()
     RETURNING id`,
    [tgUserId, text]
  );

  const masterId = masterRes.rows[0].id;
  const slug = await ensureUniqueMasterSlug(masterId, text);

  await query(
    `UPDATE user_states
     SET state = 'registered', data = '{}'::jsonb, updated_at = now()
     WHERE tg_user_id = $1`,
    [tgUserId]
  );

  const baseUrl = process.env.BASE_URL || '';
  const profileUrl = baseUrl ? `${baseUrl}/m/${slug}` : `/m/${slug}`;
  await ctx.reply(`Готово, ${text}! Регистрация завершена.\nВаш публичный профиль: ${profileUrl}`);
  return true;
}
