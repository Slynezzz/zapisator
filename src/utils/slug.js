import { query } from '../db.js';

export function slugify(input) {
  const base = String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яё\s-]/gi, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return base || `master-${Date.now()}`;
}

export async function ensureUniqueMasterSlug(masterId, sourceText) {
  const base = slugify(sourceText);
  let candidate = base;
  let suffix = 1;

  while (true) {
    const exists = await query('SELECT id FROM masters WHERE public_slug = $1 AND id <> $2 LIMIT 1', [candidate, masterId]);
    if (!exists.rows[0]) {
      await query('UPDATE masters SET public_slug = $1 WHERE id = $2', [candidate, masterId]);
      return candidate;
    }
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

export async function ensureSlugsForExistingMasters() {
  const masters = await query('SELECT id, name, public_slug FROM masters');
  for (const master of masters.rows) {
    if (!master.public_slug) {
      await ensureUniqueMasterSlug(master.id, master.name || `master-${master.id}`);
    }
  }
}
