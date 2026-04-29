export function createMockProvider({ baseUrl }) {
  return {
    name: 'mock',
    async createIntent({ paymentId, bookingId }) {
      return {
        providerPaymentId: `mock_${paymentId}`,
        paymentUrl: `${baseUrl}/pay/mock/${bookingId}`,
        payload: { type: 'mock' }
      };
    }
  };
}
