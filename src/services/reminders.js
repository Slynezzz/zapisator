import { query } from '../db.js';
import { enqueueOutboxMessage } from './outbox.js';

export async function scheduleDueReminders(limit = 100) {
  const bookingsRes = await query(
    `SELECT b.id, b.client_external_user_id, b.source_channel, s.start_at
     FROM bookings b
     JOIN master_slots s ON s.id = b.slot_id
     WHERE b.booking_status IN ('confirmed', 'awaiting_payment')
       AND b.payment_status IN ('pending', 'paid')
     ORDER BY s.start_at ASC
     LIMIT $1`,
    [limit]
  );

  const now = Date.now();
  for (const booking of bookingsRes.rows) {
    const startAt = new Date(booking.start_at).getTime();
    const hoursToStart = (startAt - now) / (1000 * 60 * 60);
    const channel = booking.source_channel === 'telegram' ? 'telegram' : 'max';
    if (!booking.client_external_user_id) continue;

    if (hoursToStart <= 24.1 && hoursToStart > 23 && !(await wasReminderSent(booking.id, '24h'))) {
      await enqueueOutboxMessage({
        eventType: 'booking_reminder_24h',
        channel,
        recipientExternalId: booking.client_external_user_id,
        payload: { bookingId: booking.id, startAt: booking.start_at },
        dedupeKey: `booking:${booking.id}:reminder24h`
      });
      await markReminderSent(booking.id, '24h');
    }

    if (hoursToStart <= 2.1 && hoursToStart > 1 && !(await wasReminderSent(booking.id, '2h'))) {
      await enqueueOutboxMessage({
        eventType: 'booking_reminder_2h',
        channel,
        recipientExternalId: booking.client_external_user_id,
        payload: { bookingId: booking.id, startAt: booking.start_at },
        dedupeKey: `booking:${booking.id}:reminder2h`
      });
      await markReminderSent(booking.id, '2h');
    }
  }
}

async function wasReminderSent(bookingId, type) {
  const field = type === '24h' ? 'reminder_24h_sent_at' : 'reminder_2h_sent_at';
  const res = await query(`SELECT ${field} AS sent_at FROM bookings WHERE id = $1`, [bookingId]);
  return Boolean(res.rows[0]?.sent_at);
}

async function markReminderSent(bookingId, type) {
  const field = type === '24h' ? 'reminder_24h_sent_at' : 'reminder_2h_sent_at';
  await query(`UPDATE bookings SET ${field} = now(), updated_at = now() WHERE id = $1`, [bookingId]);
}
