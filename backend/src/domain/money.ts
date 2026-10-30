const AMOUNT = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/;

export function parseCents(input: string): number {
  const text = input.trim();
  if (!AMOUNT.test(text)) throw new RangeError('Invalid amount');
  const [whole, fraction = ''] = text.replaceAll(',', '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new RangeError('Amount too large');
  return cents;
}

export function formatKes(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+$)/g, ',');
  return `${sign}KES ${whole}.${String(abs % 100).padStart(2, '0')}`;
}
