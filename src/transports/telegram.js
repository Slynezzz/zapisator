export async function sendTelegramMessage({ chatId, text }) {
  const token = process.env.TG_BOT_TOKEN;
  if (!token) throw new Error('TG_BOT_TOKEN missing');
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: Number(chatId), text })
  });
  if (!resp.ok) throw new Error(`Telegram send failed: ${resp.status}`);
}
