// ablate.mjs — delete a clause, measure whether anything changed, and refuse to overclaim.
//
// Every prompt tool SCORES a prompt. None of them delete a clause and measure. So system prompts
// accrete: someone adds "think step by step" in March, nobody ever removes it, and you pay for those
// tokens on every call for the rest of the product's life. The clause might be load-bearing. Nobody
// has ever checked, because checking requires an evaluation harness and a significance test.
//
// THREE WAYS THIS GOES WRONG, ALL HANDLED HERE RATHER THAN IN A DISCLAIMER
//
// 1 · A DELTA IS NOT A FINDING. Removing a clause and watching the score drop by one means nothing on
//     twenty items. Every verdict here goes through an exact sign test, and a movement that does not
//     beat a coin is INCONCLUSIVE — never DEAD.
//
// 2 · INDIVIDUALLY REMOVABLE IS NOT JOINTLY REMOVABLE. This is the real trap and it is the reason
//     leave-one-out ablation is dangerous. Two clauses can each be removable alone and disastrous
//     together: each covers for the other, so dropping either is free and dropping both is not.
//     A tool that lists eight dead clauses and lets you delete all eight has told you something it
//     did not measure. So this REFUSES to certify a batch until the joint variant — all of them gone
//     at once — has actually been run and held.
//
// 3 · AN AGGREGATE SCORE HIDES A SAFETY REGRESSION. Deleting a safety clause because the total did not
//     move is the same poison as choosing a preference pair on aggregate. A clause whose removal moves
//     a protected axis is never DEAD, however flat the total is.
//
// Nothing here calls a model. The caller runs their own eval on each variant and hands back the
// scores, which keeps the kernel pure, keeps it usable with any harness, and is what makes the
// significance test possible at all.
//
// Pure and deterministic: no I/O, no clock, no randomness.
import { segment, render, baselineOf, renderDrift } from './segment.mjs';

export const SPEC_VERSION = 'konomi-ablate-v1';
export const BASELINE = 'baseline';
export const JOINT = 'joint';

// Vendored verbatim from sjgant80-hub/konomi-regress (compare.mjs). CI checks it has not drifted.
export const MAX_EXACT_N = 4096;
export function signTest(improved, regressed) {
  const n = improved + regressed;
  if (n === 0) return { n: 0, k: 0, p: 1, exact: true };
  if (n > MAX_EXACT_N) return { n, k: Math.min(improved, regressed), p: null, exact: false };
  const k = Math.min(improved, regressed);
  let sum = 0n, c = 1n;
  for (let i = 0; i <= k; i++) {
    if (i > 0) c = (c * BigInt(n - i + 1)) / BigInt(i);
    sum += c;
  }
  const total = 1n << BigInt(n);
  const SCALE = 1000000000000n;
  let p = Number((2n * sum * SCALE) / total) / Number(SCALE);
  if (p > 1) p = 1;
  return { n, k, p, exact: true };
}

// The seven axes, vendored from konomi-rubric (canonical). CI fails on drift.
export const AXES = Object.freeze([
  'grounding', 'comprehension', 'compliance', 'completeness', 'reasoning', 'safety', 'calibration',
]);
export const DEFAULT_PROTECTED = Object.freeze(['safety', 'grounding']);

export const DEAD = 'DEAD';                   // removal changed nothing that beat chance
export const LOAD_BEARING = 'LOAD_BEARING';   // removal made it measurably worse
export const HARMFUL = 'HARMFUL';             // removal made it measurably BETTER
export const PROTECTED = 'PROTECTED';         // removal moved a protected axis; never delete on aggregate
export const INCONCLUSIVE = 'INCONCLUSIVE';   // not enough evidence either way
export const VERDICTS = Object.freeze([DEAD, LOAD_BEARING, HARMFUL, PROTECTED, INCONCLUSIVE]);

export const DEFAULTS = Object.freeze({ alpha: 0.05, minItems: 20, protectedAxes: DEFAULT_PROTECTED });

/**
 * The runs to perform: a rendered baseline, one variant per clause, and — when asked — the joint
 * variant with a whole candidate set removed at once.
 *
 * `jointOmit` is supplied on a SECOND pass, once a first analysis has proposed a dead set. That two
 * pass shape is deliberate: you cannot know which clauses to test jointly until you have tested them
 * singly, and pretending otherwise is how the interaction problem gets skipped.
 */
export function plan(prompt, { strategy = 'line', jointOmit = null, joiner = '\n' } = {}) {
  const clauses = segment(prompt, { strategy });
  if (clauses.length === 0) throw new Error('nothing to ablate — the prompt produced no clauses');
  if (clauses.length === 1) throw new Error('a single-clause prompt has nothing to compare against');

  const variants = clauses.map(c => ({
    id: `without-${c.index}`, omits: [c.index], clause: c.text, prompt: render(clauses, [c.index], { joiner }),
  }));
  if (Array.isArray(jointOmit) && jointOmit.length > 1) {
    variants.push({ id: JOINT, omits: [...jointOmit].sort((a, b) => a - b), clause: null, prompt: render(clauses, jointOmit, { joiner }) });
  }
  return {
    spec: SPEC_VERSION, strategy, clauses,
    baseline: { id: BASELINE, omits: [], prompt: baselineOf(clauses, { joiner }) },
    variants, drift: renderDrift(prompt, clauses, { joiner }),
    runs: variants.length + 1,
  };
}

// item score → a comparable total, whether it is a number or a konomi-rubric vector
const totalOf = s => (Array.isArray(s) ? s.reduce((a, b) => a + b, 0) : Number(s));
const axisOf = (s, i) => (Array.isArray(s) ? s[i] : null);

/** Paired movement of one variant against the baseline. Item-by-item, never aggregate-to-aggregate. */
function movement(base, variant, protectedAxes) {
  const n = Math.min(base.length, variant.length);
  let improved = 0, regressed = 0, net = 0;
  for (let i = 0; i < n; i++) {
    const d = totalOf(variant[i]) - totalOf(base[i]);
    net += d;
    if (d > 0) improved++; else if (d < 0) regressed++;
  }
  const perAxis = AXES.map((axis, a) => {
    let delta = 0, seen = false;
    for (let i = 0; i < n; i++) {
      const bv = axisOf(base[i], a), vv = axisOf(variant[i], a);
      if (bv === null || vv === null) continue;
      seen = true; delta += vv - bv;
    }
    return { axis, delta: seen ? delta : null, protectedAxis: protectedAxes.includes(axis) };
  });
  return { paired: n, improved, regressed, unchanged: n - improved - regressed, net, perAxis, signTest: signTest(improved, regressed) };
}

/**
 * Score every variant against the baseline and give each clause a verdict.
 *
 * `results` maps variant id → an array of per-item scores, in the SAME item order as the baseline.
 * Scores are numbers or seven-place vectors; vectors additionally enable the protected-axis check,
 * which is the only reason to prefer them.
 */
export function analyse(p, results, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const base = results[BASELINE];
  if (!Array.isArray(base)) throw new Error('results must include a baseline run under the id "baseline"');

  const clauses = p.clauses.map(c => {
    const r = results[`without-${c.index}`];
    if (!Array.isArray(r)) {
      return { ...c, verdict: INCONCLUSIVE, ran: false, reasons: ['this variant was never run'], move: null };
    }
    const m = movement(base, r, o.protectedAxes);
    const reasons = [];
    let verdict;

    const movedProtected = m.perAxis.filter(a => a.protectedAxis && a.delta !== null && a.delta !== 0);
    const significant = m.signTest.exact && m.signTest.p !== null && m.signTest.p <= o.alpha;

    if (m.paired < o.minItems) {
      verdict = INCONCLUSIVE;
      reasons.push(`only ${m.paired} paired item(s); ${o.minItems} needed before a verdict on a clause means anything`);
    } else if (movedProtected.length) {
      // never DEAD on aggregate evidence when a protected axis moved at all
      verdict = PROTECTED;
      reasons.push(`removing it moved ${movedProtected.map(a => `${a.axis} ${a.delta > 0 ? '+' : ''}${a.delta}`).join(', ')} — a protected axis, so this is never deleted on the strength of a flat total`);
    } else if (!significant) {
      verdict = m.improved + m.regressed === 0 ? DEAD : INCONCLUSIVE;
      reasons.push(m.improved + m.regressed === 0
        ? 'removing it changed no item at all'
        : `${m.improved} up, ${m.regressed} down gives p = ${m.signTest.p === null ? 'n/a' : m.signTest.p.toFixed(3)}, which does not beat a coin`);
    } else if (m.net < 0) {
      verdict = LOAD_BEARING;
      reasons.push(`removing it cost ${Math.abs(m.net)} points across ${m.paired} items (p = ${m.signTest.p.toFixed(4)})`);
    } else {
      verdict = HARMFUL;
      reasons.push(`removing it GAINED ${m.net} points (p = ${m.signTest.p.toFixed(4)}) — this clause is making the output worse`);
    }
    return { ...c, verdict, ran: true, reasons, move: m };
  });

  const candidates = clauses.filter(c => c.verdict === DEAD || c.verdict === HARMFUL).map(c => c.index);
  const joint = analyseJoint(p, results, candidates, base, o);

  return {
    spec: SPEC_VERSION, strategy: p.strategy, clauses,
    byVerdict: Object.fromEntries(VERDICTS.map(v => [v, clauses.filter(c => c.verdict === v).map(c => c.index)])),
    candidates, joint,
    certified: joint.status === 'HELD' ? candidates : [],
    drift: p.drift, thresholds: o,
  };
}

/**
 * The interaction check. Individually removable is not jointly removable, so a batch is certified only
 * when the joint variant was actually run and did not degrade.
 */
export function analyseJoint(p, results, candidates, base, o) {
  if (candidates.length === 0) return { status: 'NOTHING_TO_CERTIFY', detail: 'no clause was found individually removable', candidates: [] };
  if (candidates.length === 1) {
    return { status: 'HELD', detail: 'a single clause has no interaction to test — the leave-one-out result stands on its own', candidates: candidates.slice() };
  }
  const r = results[JOINT];
  if (!Array.isArray(r)) {
    return {
      status: 'NOT_RUN', candidates: candidates.slice(),
      detail: `${candidates.length} clauses are individually removable, which is NOT the same as removing them together — two clauses can each cover for the other. Re-plan with jointOmit set to these indices, run that one extra variant, and analyse again. Until then this batch is not certified.`,
    };
  }
  const m = movement(base, r, o.protectedAxes);
  const movedProtected = m.perAxis.filter(a => a.protectedAxis && a.delta !== null && a.delta !== 0);
  const significant = m.signTest.exact && m.signTest.p !== null && m.signTest.p <= o.alpha;
  if (movedProtected.length) {
    return { status: 'BROKE', candidates: candidates.slice(), move: m, detail: `removing all ${candidates.length} together moved a protected axis (${movedProtected.map(a => a.axis).join(', ')}) even though none of them did alone — this is the interaction case, and the batch is refused` };
  }
  if (significant && m.net < 0) {
    return { status: 'BROKE', candidates: candidates.slice(), move: m, detail: `each of these was removable alone, but removing all ${candidates.length} together cost ${Math.abs(m.net)} points (p = ${m.signTest.p.toFixed(4)}) — they were covering for each other` };
  }
  return { status: 'HELD', candidates: candidates.slice(), move: m, detail: `removing all ${candidates.length} together did not degrade the score, so the batch is certified` };
}

export default {
  SPEC_VERSION, BASELINE, JOINT, AXES, DEFAULT_PROTECTED, DEFAULTS,
  DEAD, LOAD_BEARING, HARMFUL, PROTECTED, INCONCLUSIVE, VERDICTS,
  signTest, plan, analyse, analyseJoint,
};
