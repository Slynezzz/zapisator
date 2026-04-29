import { claimOutboxBatch, markOutboxDelivered, markOutboxFailed } from './services/outbox.js';
import { scheduleDueReminders } from './services/reminders.js';
import { sendChannelMessage } from './services/channels.js';

function buildMessageText(message) {
  const p = message.payload || {};
  switch (message.event_type) {
    case 'booking_created': return `Запись создана (#${p.bookingId}).`;
    case 'payment_successful': return `Оплата успешна по записи #${p.bookingId}.`;
    case 'booking_cancelled': return `Запись #${p.bookingId} отменена.`;
    case 'booking_reminder_24h': return `Напоминание: запись #${p.bookingId} через 24 часа.`;
    case 'booking_reminder_2h': return `Напоминание: запись #${p.bookingId} через 2 часа.`;
    default: return `Событие: ${message.event_type}`;
  }
}

export async function runWorkerTick() {
  await scheduleDueReminders(Number(process.env.WORKER_REMINDER_SCAN_LIMIT || 100));
  const batch = await claimOutboxBatch(Number(process.env.WORKER_OUTBOX_BATCH_SIZE || 20));
  for (const msg of batch) {
    try {
      await sendChannelMessage({ channel: msg.channel, recipientExternalId: msg.recipient_external_id, text: buildMessageText(msg) });
      await markOutboxDelivered(msg.id);
    } catch (error) {
      await markOutboxFailed(msg.id, error.message);
    }
  }
}

export async function startWorkerLoop() {
  const intervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS || 5000);
  setInterval(() => {
    runWorkerTick().catch((e) => console.error('Worker tick failed', e));
  }, intervalMs);
}
