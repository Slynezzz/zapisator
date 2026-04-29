import { query } from '../db.js';
import {
  closeSlot,
  createManualSlot,
  getMasterByTelegramId,
  listUpcomingSlots,
  setWorkingHours
} from '../services/schedule.js';

async function ensureMaster(ctx) {
  const master = await getMasterByTelegramId(ctx.from?.id);
  if (!master) {
    await ctx.reply('Сначала завершите регистрацию через /start.');
    return null;
  }
  return master;
}

async function setState(tgUserId, state, data = {}) {
  await query(
    `INSERT INTO user_states (tg_user_id, state, data)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (tg_user_id)
     DO UPDATE SET state = EXCLUDED.state, data = EXCLUDED.data, updated_at = now()`,
    [String(tgUserId), state, JSON.stringify(data)]
  );
}

export async function openScheduleMenu(ctx) {
  const master = await ensureMaster(ctx);
  if (!master) return;

  await ctx.reply(
    'Schedule:\n1) Часы: send `hours <weekday 0-6> <HH:MM> <HH:MM>`\n2) Слот: send `slot <ISO-start> <ISO-end>`\n3) Список: send `slots [N]`\n4) Закрыть: send `close <slot_id>`',
    { parse_mode: 'Markdown' }
  );
  await setState(ctx.from.id, 'schedule_menu', {});
}

export async function handleScheduleInput(ctx) {
  const text = ctx.message?.text?.trim();
  if (!text) return false;

  const master = await ensureMaster(ctx);
  if (!master) return true;

  const [command, ...parts] = text.split(/\s+/);

  try {
    if (command === 'hours' && parts.length >= 3) {
      await setWorkingHours({
        masterId: master.id,
        weekdayInput: parts[0],
        startTimeInput: parts[1],
        endTimeInput: parts[2]
      });
      await ctx.reply('Рабочие часы обновлены.');
      return true;
    }

    if (command === 'slot' && parts.length >= 2) {
      const slot = await createManualSlot({
        masterId: master.id,
        startAtInput: parts[0],
        endAtInput: parts[1]
      });
      await ctx.reply(`Слот создан: #${slot.id}`);
      return true;
    }

    if (command === 'slots') {
      const slots = await listUpcomingSlots({ masterId: master.id, limit: parts[0] ?? 10 });
      if (!slots.length) {
        await ctx.reply('Ближайших слотов нет.');
        return true;
      }
      const lines = slots.map((slot) => `#${slot.id} | ${new Date(slot.start_at).toISOString()} - ${new Date(slot.end_at).toISOString()} | ${slot.status}`);
      await ctx.reply(lines.join('\n'));
      return true;
    }

    if (command === 'close' && parts.length >= 1) {
      const closed = await closeSlot({ masterId: master.id, slotIdInput: parts[0] });
      await ctx.reply(`Слот #${closed.id} закрыт (${closed.status}).`);
      return true;
    }
  } catch (error) {
    await ctx.reply(`Ошибка: ${error.message}`);
    return true;
  }

  return false;
}
