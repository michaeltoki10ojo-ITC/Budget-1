export const FIVE_DOLLAR_INCREMENT_CENTS = 500;

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
});

export function formatCurrency(cents: number): string {
  return usdFormatter.format(cents / 100);
}

export function parseCurrencyInputToCents(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return Math.round(numericValue * 100);
}

export function isFiveIncrement(cents: number): boolean {
  return cents % FIVE_DOLLAR_INCREMENT_CENTS === 0;
}

export function ensureFiveIncrement(cents: number): void {
  if (!isFiveIncrement(cents)) {
    throw new Error('Amount must be in $5 increments.');
  }
}

export function sumCents(values: number[]): number {
  return values.reduce((total, current) => total + current, 0);
}

export function centsToInputValue(cents: number, fractionDigits = 2): string {
  return (cents / 100).toFixed(fractionDigits);
}
