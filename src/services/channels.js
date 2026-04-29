import { sendTelegramMessage } from '../transports/telegram.js';
import { sendMaxMessage } from '../transports/max.js';

export async function sendChannelMessage({ channel, recipientExternalId, text }) {
  if (channel === 'telegram') {
    return sendTelegramMessage({ chatId: recipientExternalId, text });
  }
  if (channel === 'max') {
    return sendMaxMessage({ userId: recipientExternalId, text });
  }
  throw new Error(`Unsupported channel: ${channel}`);
}
