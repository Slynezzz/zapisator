import { query } from '../db.js';

const SLOT_STATUSES = new Set(['available', 'reserved', 'blocked', 'closed']);

function parseWeekday(input) {
  const weekday = Number(input);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new Error('Weekday must be an integer from 0 to 6.');
  }
  return weekday;
}

function parseTime(input) {
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(input)) {
    throw new Error('Time must be in HH:MM 24h format.');
  }
  return input;
}

function parseIsoDateTime(input) {
  const value = new Date(input);
  if (Number.isNaN(value.getTime())) {
    throw new Error('Datetime must be valid ISO format, e.g. 2026-05-01T10:00:00Z');
  }
  return value;
}

export async function getMasterByTelegramId(tgUserId) {
  const result = await query('SELECT id, name FROM masters WHERE tg_user_id = $1', [String(tgUserId)]);
  return result.rows[0] || null;
}

export async function setWorkingHours({ masterId, weekdayInput, startTimeInput, endTimeInput, isActive = true }) {
  const weekday = parseWeekday(weekdayInput);
  const startTime = parseTime(startTimeInput);
  const endTime = parseTime(endTimeInput);
  if (endTime <= startTime) {
    throw new Error('End time must be after start time.');
  }

  await query(
    `INSERT INTO working_hours (master_id, weekday, start_time, end_time, is_active)
     VALUES ($1, $2, $3::time, $4::time, $5)
     ON CONFLICT (master_id, weekday)
     DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, is_active = EXCLUDED.is_active`,
    [masterId, weekday, startTime, endTime, Boolean(isActive)]
  );
}

export async function createManualSlot({ masterId, startAtInput, endAtInput, source = 'manual' }) {
  const startAt = parseIsoDateTime(startAtInput);
  const endAt = parseIsoDateTime(endAtInput);
  if (endAt <= startAt) {
    throw new Error('Slot end must be after slot start.');
  }
  if (startAt.getTime() < Date.now()) {
    throw new Error('Slot start cannot be in the past.');
  }

  const result = await query(
    `INSERT INTO master_slots (master_id, start_at, end_at, status, source)
     VALUES ($1, $2, $3, 'available', $4)
     RETURNING id, start_at, end_at, status, source`,
    [masterId, startAt.toISOString(), endAt.toISOString(), source]
  );

  return result.rows[0];
}

export async function listUpcomingSlots({ masterId, limit = 10 }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const result = await query(
    `SELECT id, start_at, end_at, status, source
     FROM master_slots
     WHERE master_id = $1 AND start_at >= now()
     ORDER BY start_at ASC
     LIMIT $2`,
    [masterId, safeLimit]
  );
  return result.rows;
}

export async function closeSlot({ masterId, slotIdInput }) {
  const slotId = Number(slotIdInput);
  if (!Number.isInteger(slotId) || slotId <= 0) {
    throw new Error('Slot id must be a positive integer.');
  }

  const existing = await query('SELECT id, status FROM master_slots WHERE id = $1 AND master_id = $2', [slotId, masterId]);
  if (!existing.rows[0]) {
    throw new Error('Slot not found.');
  }
  if (existing.rows[0].status !== 'available') {
    throw new Error('Only available slots can be closed.');
  }

  const nextStatus = 'closed';
  if (!SLOT_STATUSES.has(nextStatus)) {
    throw new Error('Invalid slot status.');
  }

  await query('UPDATE master_slots SET status = $1 WHERE id = $2 AND master_id = $3', [nextStatus, slotId, masterId]);
  return { id: slotId, status: nextStatus };
}
