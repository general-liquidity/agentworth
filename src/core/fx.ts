// Multi-currency / FX. A mandate is denominated in one currency; a payment in a
// different currency is converted to the mandate's currency so caps + budget are
// always enforced in the mandate's terms. Rates come from an injected source (no
// hardcoded rates). If no rate exists, the gate treats the mandate as not covering
// the payment (→ operator confirmation), never a silent mis-conversion.
//
// Assumes both currencies share a minor-unit scale (e.g. 2 decimals: GBP pence ↔
// USD cents). Cross-decimal currencies (e.g. JPY, 0 decimals) need a scale factor
// — a known limitation, flagged rather than faked.

export interface FxRateSource {
  /** Units of `to` per unit of `from`; undefined if unknown. */
  rate(from: string, to: string): number | undefined;
}

export function fixedRateSource(rates: Record<string, number>): FxRateSource {
  return {
    rate: (from, to) => (from === to ? 1 : rates[`${from}/${to}`]),
  };
}

export function convertMinor(amountMinor: number, rate: number): number {
  return Math.round(amountMinor * rate);
}

// --- Cross-decimal conversion ------------------------------------------------
// `convertMinor` above is correct ONLY when both currencies share a minor-unit
// scale (2 ↔ 2). When they differ — JPY (0 decimals) → GBP (2 decimals) — a raw
// rate-multiply mis-sizes the result by 10^(toDecimals - fromDecimals): ¥10,000
// at 0.0053 GBP/JPY is £53.00 = 5300 pence, but `convertMinor(10000, 0.0053)`
// returns 53 (¥-scaled, off by 100×), so a cap denominated in pence is mis-checked.
//
// `convertMinorCrossDecimal` rescales by the decimal delta. It's OPTIONAL and
// dep-free by default; when `dinero.js` is installed it backs the arithmetic with
// dinero's integer money type (dynamic import — `dinero.js` lives in
// optionalDependencies, absent by default and the default behaviour is unchanged).

/** ISO-4217 minor-unit exponents for the currencies that don't use 2 decimals.
 *  Anything not listed defaults to 2 (the common case). Structural rule, not a
 *  symbol allow-list — it only encodes the decimal exponent the standard fixes. */
const MINOR_UNIT_EXPONENT: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  CLP: 0,
  ISK: 0,
  VND: 0,
  XOF: 0,
  XAF: 0,
  XPF: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
  JOD: 3,
  IQD: 3,
  LYD: 3,
};

/** Minor-unit decimal exponent for a currency (default 2). */
export function minorUnitExponent(currency: string): number {
  return MINOR_UNIT_EXPONENT[currency.toUpperCase()] ?? 2;
}

/**
 * Convert `amountMinor` (in `from`'s minor units) to `to`'s minor units at `rate`
 * (units of `to` per unit of `from`, in MAJOR terms — the same rate FX feeds quote),
 * rescaling for any minor-unit decimal mismatch. For same-decimal pairs this equals
 * `convertMinor`. Synchronous, dep-free, deterministic.
 */
export function convertMinorCrossDecimal(
  amountMinor: number,
  rate: number,
  from: string,
  to: string,
): number {
  const scale = 10 ** (minorUnitExponent(to) - minorUnitExponent(from));
  return Math.round(amountMinor * rate * scale);
}

/**
 * Optional `dinero.js`-backed cross-decimal conversion. Identical result to
 * `convertMinorCrossDecimal` but performs the arithmetic through dinero's integer
 * money type (correct minor-unit scaling, no float drift on the money value). Falls
 * back to the dep-free path when `dinero.js` isn't installed, so the default
 * behaviour is unchanged when the optional dependency is absent.
 */
export async function convertMinorCrossDecimalDinero(
  amountMinor: number,
  rate: number,
  from: string,
  to: string,
): Promise<number> {
  // dinero.js is an optionalDependency, absent by default. We resolve it via a
  // computed specifier so it stays out of static module resolution; if the import
  // fails at runtime we fall back to the identical-result dep-free path, so the
  // default behaviour is unchanged.
  let factory: unknown;
  try {
    const spec = "dinero.js";
    const mod = (await import(spec)) as { default?: unknown };
    factory = mod.default ?? mod;
  } catch {
    return convertMinorCrossDecimal(amountMinor, rate, from, to);
  }
  if (typeof factory !== "function") {
    return convertMinorCrossDecimal(amountMinor, rate, from, to);
  }

  const fromExp = minorUnitExponent(from);
  const toExp = minorUnitExponent(to);
  // Express the FX rate as an integer multiplier / 10^p so dinero stays integer:
  // dineroAmount(in from-minor) × scaledRate / 10^p, then rescale by the decimal
  // delta. dinero multiply takes an integer factor.
  const p = 9;
  const scaledRate = Math.round(rate * 10 ** p * 10 ** (toExp - fromExp));
  try {
    const money = (factory as (o: { amount: number }) => {
      multiply: (m: number) => { getAmount: () => number };
    })({ amount: amountMinor });
    const product = money.multiply(scaledRate).getAmount();
    return Math.round(product / 10 ** p);
  } catch {
    return convertMinorCrossDecimal(amountMinor, rate, from, to);
  }
}
