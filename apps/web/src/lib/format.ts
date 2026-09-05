import { formatGrouped, formatShort } from '@trivia/shared';

/** Write a number back into the shorthand a player would have typed. */
export function toShorthand(value: number): string {
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (abs >= 1e27) {
    const exponent = Math.floor(Math.log10(abs));
    const mantissa = value / Math.pow(10, exponent);
    return `${round(mantissa, 2)}e${exponent}`;
  }
  const units: Array<[number, string]> = [
    [1e15, 'q'],
    [1e12, 't'],
    [1e9, 'b'],
    [1e6, 'm'],
    [1e3, 'k'],
  ];
  for (const [factor, suffix] of units) {
    if (abs >= factor) return `${round(value / factor, 3)}${suffix}`;
  }
  return String(round(value, 4));
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/** Strip a trailing shorthand suffix so a new one can replace it. */
export function stripSuffix(text: string): string {
  return text.replace(
    /\s*(k|m|mn|b|bn|t|tn|q|qd|qn|thousand|million|billion|trillion|quadrillion|quintillion)s?\s*$/i,
    '',
  );
}

export function formatPoints(points: number): string {
  return points > 0 ? `+${formatGrouped(points)}` : formatGrouped(points);
}

export { formatGrouped, formatShort };

/** Ordinal for podium ranks: 1st, 2nd, 3rd. */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
