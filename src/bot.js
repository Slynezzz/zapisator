import { Bot } from 'grammy';
import { handleStart } from './handlers/start.js';
import { handleRegistrationInput, startRegistration } from './handlers/register.js';
import { handleScheduleInput, openScheduleMenu } from './handlers/schedule.js';
import { handleBookingInput, showMyBookings, startBookingFlow } from './handlers/booking.js';

export function createTelegramBot(token) {
  const bot = new Bot(token);

  bot.command('start', handleStart);
  bot.command('schedule', openScheduleMenu);
  bot.command('book', startBookingFlow);
  bot.command('mybookings', showMyBookings);

  bot.callbackQuery('register:start', async (ctx) => {
    await ctx.answerCallbackQuery();
    await startRegistration(ctx);
  });

  bot.callbackQuery('schedule:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    await openScheduleMenu(ctx);
  });

  bot.callbackQuery('booking:start', async (ctx) => {
    await ctx.answerCallbackQuery();
    await startBookingFlow(ctx);
  });

  bot.callbackQuery('booking:mine', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMyBookings(ctx);
  });

  bot.on('message:text', async (ctx, next) => {
    const registrationHandled = await handleRegistrationInput(ctx);
    if (registrationHandled) return;

    const bookingHandled = await handleBookingInput(ctx);
    if (bookingHandled) return;

    const scheduleHandled = await handleScheduleInput(ctx);
    if (!scheduleHandled) {
      await next();
    }
  });

  return bot;
}
