export async function sendMaxMessage({ userId, text }) {
  const token = process.env.MAX_BOT_TOKEN;
  const base = process.env.MAX_API_URL || 'https://botapi.max.ru';
  if (!token) throw new Error('MAX_BOT_TOKEN missing');

  const resp = await fetch(`${base}/messages/send`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ user_id: String(userId), text })
  });
  if (!resp.ok) throw new Error(`MAX send failed: ${resp.status}`);
}
