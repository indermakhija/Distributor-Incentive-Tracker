// Shared numeric helpers. Pure functions, usable from Node and the browser.

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const round = (v, dp = 2) => (isNum(v) ? Math.round(v * 10 ** dp) / 10 ** dp : null);

export const last = (arr) => (Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null);

export const lastN = (arr, n) => (Array.isArray(arr) ? arr.slice(Math.max(0, arr.length - n)) : []);

export const sum = (arr) => (arr || []).filter(isNum).reduce((a, b) => a + b, 0);

export const mean = (arr) => {
  const v = (arr || []).filter(isNum);
  return v.length ? sum(v) / v.length : null;
};

export const median = (arr) => {
  const v = (arr || []).filter(isNum).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export const stdev = (arr) => {
  const v = (arr || []).filter(isNum);
  if (v.length < 2) return null;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};

export const safeDiv = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);

/** Compound annual growth rate between first and last value over `years` periods. */
export const cagr = (first, lastV, years) => {
  if (!isNum(first) || !isNum(lastV) || first <= 0 || lastV <= 0 || !years) return null;
  return (lastV / first) ** (1 / years) - 1;
};

/** CAGR over the trailing n periods of a series. */
export const seriesCagr = (arr, n) => {
  const v = Array.isArray(arr) ? arr : [];
  if (v.length < 2) return null;
  const periods = Math.min(n ?? v.length - 1, v.length - 1);
  return cagr(v[v.length - 1 - periods], v[v.length - 1], periods);
};

export const yoy = (arr) =>
  (arr || []).map((v, i) => (i === 0 ? null : safeDiv(v - arr[i - 1], Math.abs(arr[i - 1]))));

export const zip = (a, b, fn) => (a || []).map((v, i) => fn(v, b?.[i], i));

/** Linear map of x in [x0,x1] onto [y0,y1], clamped. */
export const scale = (x, x0, x1, y0 = 0, y1 = 10) => {
  if (!isNum(x)) return null;
  const t = clamp((x - x0) / (x1 - x0), 0, 1);
  return y0 + t * (y1 - y0);
};

export const pct = (v, dp = 1) => (isNum(v) ? `${(v * 100).toFixed(dp)}%` : 'n/a');

export const fmt = (v, dp = 0) =>
  isNum(v) ? v.toLocaleString('en-IN', { maximumFractionDigits: dp, minimumFractionDigits: dp }) : 'n/a';

/** Bisection root finder. Returns null if no sign change in [lo, hi]. */
export const bisect = (fn, lo, hi, tol = 1e-6, maxIter = 200) => {
  let flo = fn(lo);
  const fhi = fn(hi);
  if (!isNum(flo) || !isNum(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const fm = fn(mid);
    if (!isNum(fm)) return null;
    if (Math.abs(fm) < tol || hi - lo < tol) return mid;
    if (fm * flo < 0) hi = mid;
    else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
};

export const monthsBetween = (fromIso, to = new Date()) => {
  if (!fromIso) return null;
  const d = new Date(fromIso);
  if (Number.isNaN(d.getTime())) return null;
  const t = to instanceof Date ? to : new Date(to);
  return (t - d) / (1000 * 60 * 60 * 24 * 30.44);
};

export const daysBetween = (fromIso, to = new Date()) => {
  const m = monthsBetween(fromIso, to);
  return m == null ? null : m * 30.44;
};

/** Provenance labels used across the app to distinguish fact from judgment. */
export const PROVENANCE = {
  reported: 'Reported fact',
  uploaded: 'User-uploaded data',
  sample: 'Illustrative sample data',
  calculated: 'Calculated metric',
  external_forecast: 'External forecast',
  ai_estimate: 'AI-generated estimate',
  assumption: 'Model assumption',
  judgment: 'Subjective judgment',
  manual: 'Manually entered'
};
