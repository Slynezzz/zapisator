import { getClient, query } from '../db.js';
import { enqueueOutboxMessage } from './outbox.js';

function normalizePhone(phone) {
  const normalized = String(phone || '').replace(/[^\d+]/g, '');
  if (!/^\+?\d{10,15}$/.test(normalized)) {
    throw new Error('Phone must be valid and contain 10-15 digits.');
  }
  return normalized;
}

export async function listMasters() {
  const res = await query('SELECT id, name FROM masters ORDER BY id ASC LIMIT 50');
  return res.rows;
}

export async function getMasterBySlug(slug) {
  const res = await query('SELECT id, name, public_slug FROM masters WHERE public_slug = $1 LIMIT 1', [slug]);
  return res.rows[0] || null;
}

export async function listMasterServices(masterId) {
  const res = await query(
    'SELECT id, name, duration_minutes, price_cents FROM master_services WHERE master_id = $1 AND is_active = TRUE ORDER BY id ASC',
    [masterId]
  );
  return res.rows;
}

export async function listAvailableSlots(masterId, limit = 10) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 30);
  const res = await query(
    `SELECT id, start_at, end_at FROM master_slots
     WHERE master_id = $1 AND status = 'available' AND start_at >= now()
     ORDER BY start_at ASC
     LIMIT $2`,
    [masterId, safeLimit]
  );
  return res.rows;
}

export async function listCustomerBookingsByTelegramUser(telegramUserId, limit = 10) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 30);
  const res = await query(
    `SELECT b.id, b.booking_status, b.payment_status, b.created_at, ms.start_at, m.name AS master_name, s.name AS service_name
     FROM bookings b
     JOIN customers c ON c.id = b.customer_id
     JOIN master_slots ms ON ms.id = b.slot_id
     JOIN masters m ON m.id = b.master_id
     JOIN master_services s ON s.id = b.service_id
     WHERE c.telegram_user_id = $1
     ORDER BY b.created_at DESC
     LIMIT $2`,
    [String(telegramUserId), safeLimit]
  );
  return res.rows;
}

export async function createBookingFromChannel(input) {
  const {
    masterId,
    serviceId,
    slotId,
    customerName,
    customerPhone,
    sourceChannel,
    clientExternalUserId,
    note = null
  } = input;

  if (!customerName || String(customerName).trim().length < 2) {
    throw new Error('Customer name is required.');
  }

  const phone = normalizePhone(customerPhone);
  const client = await getClient();

  try {
    await client.query('BEGIN');

    const slotRes = await client.query('SELECT id, status, master_id, start_at FROM master_slots WHERE id = $1 FOR UPDATE', [slotId]);
    const slot = slotRes.rows[0];
    if (!slot || Number(slot.master_id) !== Number(masterId)) {
      throw new Error('Slot not found for this master.');
    }
    if (slot.status !== 'available') {
      throw new Error('Slot is not available.');
    }
    if (new Date(slot.start_at).getTime() < Date.now()) {
      throw new Error('Slot is in the past.');
    }

    const serviceRes = await client.query('SELECT id, master_id FROM master_services WHERE id = $1 AND is_active = TRUE', [serviceId]);
    const service = serviceRes.rows[0];
    if (!service || Number(service.master_id) !== Number(masterId)) {
      throw new Error('Service not found for this master.');
    }

    const customerRes = await client.query(
      `SELECT id FROM customers WHERE telegram_user_id = $1 AND phone = $2 LIMIT 1`,
      [String(clientExternalUserId || ''), phone]
    );

    let customerId;
    if (customerRes.rows[0]) {
      customerId = customerRes.rows[0].id;
      await client.query('UPDATE customers SET name = $1 WHERE id = $2', [customerName, customerId]);
    } else {
      const createdCustomer = await client.query(
        `INSERT INTO customers (name, phone, telegram_user_id)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [customerName.trim(), phone, String(clientExternalUserId || '')]
      );
      customerId = createdCustomer.rows[0].id;
    }

    const bookingRes = await client.query(
      `INSERT INTO bookings (
        master_id, customer_id, service_id, slot_id,
        booking_status, payment_status, source_channel, client_external_user_id, note
      ) VALUES ($1, $2, $3, $4, 'pending', 'unpaid', $5, $6, $7)
      RETURNING id, booking_status, payment_status, created_at`,
      [masterId, customerId, serviceId, slotId, sourceChannel, String(clientExternalUserId || ''), note]
    );

    await client.query("UPDATE master_slots SET status = 'reserved' WHERE id = $1", [slotId]);

    await client.query('COMMIT');

    const booking = bookingRes.rows[0];
    if (sourceChannel === 'telegram' && clientExternalUserId) {
      await enqueueOutboxMessage({
        eventType: 'booking_created',
        channel: 'telegram',
        recipientExternalId: clientExternalUserId,
        payload: { bookingId: booking.id },
        dedupeKey: `booking:${booking.id}:created`
      });
    }
    return booking;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
