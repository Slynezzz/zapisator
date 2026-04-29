import { buildMainKeyboard } from '../keyboards/main.js';

export async function handleStart(ctx) {
  await ctx.reply(
    'Добро пожаловать в Записатор. Это ваш цифровой офис для записи клиентов.',
    { reply_markup: buildMainKeyboard() }
  );
}
