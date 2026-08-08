// cost.mjs — what the dead clauses are costing, stated to the precision the estimate actually supports.
//
// This is the number that makes the whole exercise worth doing: a system prompt is billed on EVERY
// call, so a dead clause is a standing charge for the life of the product. Six hundred wasted tokens
// at forty thousand calls a month is twenty-four million tokens buying nothing.
//
// HONESTY ABOUT THE TOKEN COUNT
//
// Exact tokenisation needs the model's own tokeniser, which is model-specific and not available here.
// So `estimateTokens` is a heuristic, it is named as one, every result carries `estimated: true`, and
// the money figure is ROUNDED rather than printed to the penny — a spuriously precise number from an
// approximate count is the kind of thing that ends up in a slide and then in an argument.
//
// If you have exact counts, pass them. The estimator exists so the tool is useful before you do, not
// to pretend it is unnecessary.
//
// Pure and deterministic: no I/O, no clock, no randomness.

// Roughly four characters per token for English prose, adjusted upward for punctuation and markup,
// which tokenise less efficiently than words. Good to about ±20% on ordinary system prompts, which is
// stated in the result rather than left for the reader to discover.
export const CHARS_PER_TOKEN = 4;
export const ESTIMATE_ERROR = 0.2;

/** A rough token count. An ESTIMATE — see the note above. */
export function estimateTokens(text) {
  const s = String(text == null ? '' : text);
  if (!s.trim()) return 0;
  const words = s.trim().split(/\s+/).length;
  const punctuation = (s.match(/[^\w\s]/g) || []).length;
  const byChars = Math.ceil(s.length / CHARS_PER_TOKEN);
  // take the larger of the two views; word+punctuation is better on dense markup, chars on prose
  return Math.max(byChars, Math.ceil(words * 1.3 + punctuation * 0.5));
}

/**
 * What a set of clauses costs per call and per month.
 *
 * `tokensOf` lets you supply an exact counter; without it the estimate is used and the result says so.
 * `pricePerMillion` is the input-token price for your model — input, because a system prompt is input.
 */
export function cost(clauses, indices, { callsPerMonth = 0, pricePerMillion = 0, tokensOf = null } = {}) {
  const count = tokensOf || estimateTokens;
  const set = new Set(indices.map(Number));
  const chosen = clauses.filter(c => set.has(c.index));
  const tokens = chosen.reduce((s, c) => s + count(c.text), 0);
  const allTokens = clauses.reduce((s, c) => s + count(c.text), 0);
  const perMonthTokens = tokens * Math.max(0, callsPerMonth);
  const money = (perMonthTokens / 1e6) * Math.max(0, pricePerMillion);
  return {
    clauses: chosen.length, totalClauses: clauses.length,
    tokens, promptTokens: allTokens,
    share: allTokens === 0 ? 0 : tokens / allTokens,
    callsPerMonth, perMonthTokens, pricePerMillion,
    money, moneyRounded: roundMoney(money),
    estimated: !tokensOf, errorBand: tokensOf ? null : ESTIMATE_ERROR,
    note: tokensOf
      ? 'Token counts supplied by the caller.'
      : `Token counts are estimated (about ±${Math.round(ESTIMATE_ERROR * 100)}%). Supply an exact tokeniser for a firm figure.`,
  };
}

/**
 * Round to the precision an estimate supports. A ±20% token count cannot justify pence, so anything
 * over ten is whole units and anything over a thousand is to the nearest ten.
 */
export function roundMoney(v) {
  const n = Number(v) || 0;
  if (n === 0) return 0;
  if (n < 1) return Math.round(n * 100) / 100;
  if (n < 10) return Math.round(n * 10) / 10;
  if (n < 1000) return Math.round(n);
  return Math.round(n / 10) * 10;
}

/**
 * The sentence to put in front of a person.
 * Says "certified" only when the joint run actually held, because that is the only state in which
 * deleting the whole set has been measured rather than inferred.
 */
export function headline(report, opts = {}) {
  const certified = report.certified.length > 0;
  const set = certified ? report.certified : report.candidates;
  const c = cost(report.clauses, set, opts);
  const all = cost(report.clauses, report.clauses.map(x => x.index), opts);

  if (set.length === 0) {
    return { certified: false, savings: c, prompt: all, sentence: `No clause was found individually removable. Your prompt is ${all.tokens} estimated tokens and all of it is doing something, or the corpus is too small to tell.` };
  }
  const money = c.money > 0 ? ` That is about ${fmt(c.moneyRounded)} a month at ${c.callsPerMonth.toLocaleString()} calls.` : '';
  const sentence = certified
    ? `Your prompt is about ${all.tokens} tokens. ${c.tokens} of them (${Math.round(c.share * 100)}%) make no measurable difference, and removing all ${set.length} together was tested and held.${money}`
    : `Your prompt is about ${all.tokens} tokens. ${c.tokens} of them (${Math.round(c.share * 100)}%) make no measurable difference INDIVIDUALLY — removing them together has not been tested yet, so this is not a licence to delete them all.${money}`;
  return { certified, savings: c, prompt: all, sentence };
}

const fmt = n => (n >= 1 ? `£${n.toLocaleString()}` : `£${n}`);

export default { CHARS_PER_TOKEN, ESTIMATE_ERROR, estimateTokens, cost, roundMoney, headline };
