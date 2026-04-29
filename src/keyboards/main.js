import { InlineKeyboard } from 'grammy';

export function buildMainKeyboard() {
  return new InlineKeyboard()
    .text('Начать регистрацию', 'register:start')
    .row()
    .text('Schedule', 'schedule:open')
    .text('Book', 'booking:start')
    .row()
    .text('My bookings', 'booking:mine');
}
