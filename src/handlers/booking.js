import { query } from '../db.js';
import { createPaymentIntentForBooking } from '../services/payments.js';
import {
  createBookingFromChannel,
  listAvailableSlots,
  listCustomerBookingsByTelegramUser,
  listMasters,
  listMasterServices
} from '../services/bookings.js';

async function setState(tgUserId, state, data = {}) {
  await query(
    `INSERT INTO user_states (tg_user_id, state, data)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (tg_user_id)
     DO UPDATE SET state = EXCLUDED.state, data = EXCLUDED.data, updated_at = now()`,
    [String(tgUserId), state, JSON.stringify(data)]
  );
}

async function getState(tgUserId) {
  const res = await query('SELECT state, data FROM user_states WHERE tg_user_id = $1', [String(tgUserId)]);
  return res.rows[0] || null;
}

export async function startBookingFlow(ctx) {
  const masters = await listMasters();
  if (!masters.length) return ctx.reply('Пока нет доступных мастеров.');
  await ctx.reply('Выберите мастера: ' + masters.map((m) => `${m.id}:${m.name}`).join(' | '));
  await setState(ctx.from.id, 'booking_wait_master', {});
}

export async function showMyBookings(ctx) {
  const bookings = await listCustomerBookingsByTelegramUser(ctx.from.id, 10);
  if (!bookings.length) return ctx.reply('У вас пока нет бронирований.');
  const lines = bookings.map((b) => `#${b.id} ${b.master_name} | ${b.service_name} | ${new Date(b.start_at).toISOString()} | ${b.booking_status}/${b.payment_status}`);
  await ctx.reply(lines.join('\n'));
}

export async function handleBookingInput(ctx) {
  const text = ctx.message?.text?.trim();
  if (!text) return false;
  const stateRow = await getState(ctx.from.id);
  if (!stateRow?.state?.startsWith('booking_')) return false;
  const data = stateRow.data || {};

  try {
    if (stateRow.state === 'booking_wait_master') {
      const masterId = Number(text);
      const services = await listMasterServices(masterId);
      if (!services.length) return ctx.reply('У мастера нет услуг. Введите id другого мастера.'), true;
      await ctx.reply('Выберите услугу (id): ' + services.map((s) => `${s.id}:${s.name}`).join(' | '));
      await setState(ctx.from.id, 'booking_wait_service', { masterId });
      return true;
    }

    if (stateRow.state === 'booking_wait_service') {
      const serviceId = Number(text);
      const slots = await listAvailableSlots(data.masterId, 15);
      if (!slots.length) return ctx.reply('Нет доступных слотов у выбранного мастера.'), true;
      await ctx.reply('Выберите слот (id): ' + slots.map((s) => `${s.id}:${new Date(s.start_at).toISOString()}`).join(' | '));
      await setState(ctx.from.id, 'booking_wait_slot', { ...data, serviceId });
      return true;
    }

    if (stateRow.state === 'booking_wait_slot') {
      await ctx.reply('Введите ваше имя:');
      await setState(ctx.from.id, 'booking_wait_name', { ...data, slotId: Number(text) });
      return true;
    }

    if (stateRow.state === 'booking_wait_name') {
      await ctx.reply('Введите телефон (например +79991234567):');
      await setState(ctx.from.id, 'booking_wait_phone', { ...data, customerName: text });
      return true;
    }

    if (stateRow.state === 'booking_wait_phone') {
      const booking = await createBookingFromChannel({
        masterId: data.masterId,
        serviceId: data.serviceId,
        slotId: data.slotId,
        customerName: data.customerName,
        customerPhone: text,
        sourceChannel: 'telegram',
        clientExternalUserId: ctx.from.id
      });

      const payment = await createPaymentIntentForBooking(booking.id);
      let msg = `Бронирование создано: #${booking.id}\nСтатус: ${booking.booking_status}\nОплата: ${booking.payment_status}`;
      if (payment.required && payment.paymentUrl) {
        msg += `\nОплатить: ${payment.paymentUrl}`;
      }
      await ctx.reply(msg);
      await setState(ctx.from.id, 'idle', {});
      return true;
    }
  } catch (error) {
    await ctx.reply(`Ошибка бронирования: ${error.message}`);
    return true;
  }

  return false;
}
