import { query } from '../db.js';
import { getPaymentProvider } from '../payments/registry.js';
import { enqueueOutboxMessage } from './outbox.js';

export async function createPaymentIntentForBooking(bookingId) {
  const bookingRes = await query(
    `SELECT b.id, b.payment_status, b.booking_status, b.source_channel, s.price_cents
     FROM bookings b
     JOIN master_services s ON s.id = b.service_id
     WHERE b.id = $1`,
    [bookingId]
  );
  const booking = bookingRes.rows[0];
  if (!booking) throw new Error('Booking not found');

  const amount = Number(booking.price_cents || 0);
  if (amount <= 0) {
    return { required: false, paymentUrl: null };
  }

  const provider = getPaymentProvider();

  const paymentRes = await query(
    `INSERT INTO payments (booking_id, provider, amount, currency, status)
     VALUES ($1, $2, $3, 'RUB', 'created')
     RETURNING id`,
    [bookingId, provider.name, amount]
  );

  const paymentId = paymentRes.rows[0].id;
  const intent = await provider.createIntent({ paymentId, bookingId, amount, currency: 'RUB' });

  await query(
    `UPDATE payments
     SET provider_payment_id = $1, payload = $2::jsonb, status = 'pending', updated_at = now()
     WHERE id = $3`,
    [intent.providerPaymentId, JSON.stringify(intent.payload || {}), paymentId]
  );

  await query(
    `UPDATE bookings
     SET payment_status = 'pending', booking_status = CASE WHEN booking_status = 'pending' THEN 'awaiting_payment' ELSE booking_status END, updated_at = now()
     WHERE id = $1`,
    [bookingId]
  );

  return { required: true, paymentUrl: intent.paymentUrl, paymentId };
}

export async function markPaymentPaidByBookingId(bookingId, payload = {}) {
  const paymentRes = await query(
    `SELECT id, status FROM payments WHERE booking_id = $1 ORDER BY id DESC LIMIT 1`,
    [bookingId]
  );
  const payment = paymentRes.rows[0];
  if (!payment) throw new Error('Payment not found for booking');

  if (payment.status !== 'paid') {
    await query(
      `UPDATE payments
       SET status = 'paid', payload = COALESCE(payload, '{}'::jsonb) || $1::jsonb, paid_at = now(), updated_at = now()
       WHERE id = $2`,
      [JSON.stringify(payload), payment.id]
    );
  }

  await query(
    `UPDATE bookings
     SET payment_status = 'paid', booking_status = CASE WHEN booking_status IN ('pending', 'awaiting_payment') THEN 'confirmed' ELSE booking_status END, updated_at = now()
     WHERE id = $1`,
    [bookingId]
  );

  const bookingRes = await query('SELECT source_channel, client_external_user_id FROM bookings WHERE id = $1', [bookingId]);
  const b = bookingRes.rows[0];
  if (b?.source_channel === 'telegram' && b.client_external_user_id) {
    await enqueueOutboxMessage({
      eventType: 'payment_successful',
      channel: 'telegram',
      recipientExternalId: b.client_external_user_id,
      payload: { bookingId },
      dedupeKey: `booking:${bookingId}:payment_success`
    });
  }
}
