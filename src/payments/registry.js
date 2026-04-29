import { createMockProvider } from './providers/mock.js';

export function getPaymentProvider() {
  const mode = process.env.PAYMENT_PROVIDER || 'mock';
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

  if (mode === 'mock') {
    return createMockProvider({ baseUrl });
  }

  throw new Error(`Unsupported PAYMENT_PROVIDER: ${mode}`);
}
