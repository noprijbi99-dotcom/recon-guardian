// Money — exact, integer-cent arithmetic (DESIGN-PHILOSOPHY §3: money words
// are exact — never rounded, never paraphrased, always to the cent).
// All amounts inside the guardian are integer cents. Strings like "200.00"
// exist only at the PayPal / document boundary.

export function toCents(str) {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(str).trim());
  if (!m) throw new Error(`BAD_MONEY_STRING: ${str}`);
  return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
}

export function fmt(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function fmtSigned(cents) {
  if (cents === 0) return '0.00';
  return (cents > 0 ? '+' : '-') + fmt(Math.abs(cents));
}
