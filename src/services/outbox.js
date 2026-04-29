import { getClient, query } from '../db.js';

export async function enqueueOutboxMessage({ eventType, channel, recipientExternalId, payload = {}, dedupeKey = null, maxAttempts = 5 }) {
  await query(
    `INSERT INTO outbox_messages (event_type, channel, recipient_external_id, payload, dedupe_key, max_attempts)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [eventType, channel, String(recipientExternalId), JSON.stringify(payload), dedupeKey, maxAttempts]
  );
}

export async function claimOutboxBatch(limit = 20) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `SELECT id FROM outbox_messages
       WHERE status IN ('pending', 'failed') AND next_attempt_at <= now() AND attempt_count < max_attempts
       ORDER BY id ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    const ids = res.rows.map((r) => r.id);
    if (!ids.length) {
      await client.query('COMMIT');
      return [];
    }

    const claimed = await client.query(
      `UPDATE outbox_messages
       SET status = 'processing', updated_at = now()
       WHERE id = ANY($1::bigint[])
       RETURNING *`,
      [ids]
    );
    await client.query('COMMIT');
    return claimed.rows;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function markOutboxDelivered(messageId) {
  await query(
    `UPDATE outbox_messages
     SET status = 'delivered', delivered_at = now(), updated_at = now(), attempt_count = attempt_count + 1
     WHERE id = $1`,
    [messageId]
  );
  await query(`INSERT INTO outbox_attempts (outbox_message_id, attempt_no, status) SELECT id, attempt_count, 'success' FROM outbox_messages WHERE id = $1`, [messageId]);
}

export async function markOutboxFailed(messageId, errorText) {
  const msgRes = await query('SELECT attempt_count, max_attempts FROM outbox_messages WHERE id = $1', [messageId]);
  const msg = msgRes.rows[0];
  if (!msg) return;
  const nextAttempt = Number(msg.attempt_count) + 1;
  const delayMinutes = Math.min(30, 2 ** Math.min(nextAttempt, 5));
  const dead = nextAttempt >= Number(msg.max_attempts);

  await query(
    `UPDATE outbox_messages
     SET attempt_count = attempt_count + 1,
         status = CASE WHEN $2 THEN 'dead_letter' ELSE 'failed' END,
         next_attempt_at = now() + ($3 || ' minutes')::interval,
         last_error = $4,
         updated_at = now()
     WHERE id = $1`,
    [messageId, dead, String(delayMinutes), String(errorText || 'unknown')]
  );

  await query(
    `INSERT INTO outbox_attempts (outbox_message_id, attempt_no, status, error)
     SELECT id, attempt_count, 'failed', $2 FROM outbox_messages WHERE id = $1`,
    [messageId, String(errorText || 'unknown')]
  );
}

export async function listOutboxDebug(limit = 50) {
  const res = await query('SELECT id, event_type, channel, status, attempt_count, last_error, created_at FROM outbox_messages ORDER BY id DESC LIMIT $1', [limit]);
  return res.rows;
}
