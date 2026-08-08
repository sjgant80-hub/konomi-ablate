// segment.mjs — cut a system prompt into the units you can actually delete.
//
// Ablation needs a unit. Tokens are too small (deleting one word is not a decision anyone makes) and
// the whole prompt is too large (that just tells you the prompt does something). The unit people
// actually add and remove is a CLAUSE: a line, a bullet, a sentence, a paragraph.
//
// THE METHODOLOGICAL TRAP THIS MODULE EXISTS TO AVOID
//
// The obvious implementation compares the RAW prompt against RENDERED variants — original text as the
// baseline, reassembled-minus-one-clause as each variant. That silently confounds two changes: the
// clause you removed, and every whitespace difference introduced by reassembly. A prompt with unusual
// indentation would then show every clause as load-bearing, because the baseline differs from all of
// its own variants in a way that has nothing to do with clauses.
//
// So the baseline is ALWAYS rendered through the same path as the variants. `render(clauses, [])` is
// the baseline, never the input string. It may differ from the raw input in whitespace; that is the
// point, and it is why it is exposed rather than hidden.
//
// Pure and deterministic: no I/O, no clock, no randomness.

export const VERSION = '0.1.0';
export const SPEC_VERSION = 'konomi-ablate-v1';

export const STRATEGIES = Object.freeze(['line', 'bullet', 'sentence', 'block']);

const BULLET = /^\s*(?:[-*•·]|\d+[.)])\s+/;

/**
 * Cut a prompt into clauses.
 *
 *   line      every non-empty line. The default, because it is how system prompts are written.
 *   bullet    bullet or numbered items, with any following unbulleted lines attached to the item
 *             they belong to — a wrapped bullet is one clause, not two.
 *   sentence  sentence boundaries. Finest useful grain; noisiest.
 *   block     blank-line-separated paragraphs. Coarsest; use when clauses are multi-line.
 */
export function segment(prompt, { strategy = 'line' } = {}) {
  if (!STRATEGIES.includes(strategy)) throw new Error(`strategy must be one of: ${STRATEGIES.join(', ')}`);
  const text = String(prompt == null ? '' : prompt);
  let parts = [];

  if (strategy === 'line') {
    parts = text.split('\n').map(l => l.trim()).filter(Boolean);
  } else if (strategy === 'block') {
    parts = text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  } else if (strategy === 'sentence') {
    parts = text.replace(/\s+/g, ' ').trim()
      .split(/(?<=[.!?])\s+(?=[A-Z(“"'\[])/)
      .map(s => s.trim()).filter(Boolean);
  } else {
    // bullet: a bulleted line opens a clause; unbulleted lines continue the one before it
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (BULLET.test(line) || parts.length === 0) parts.push(line);
      else parts[parts.length - 1] += ' ' + line;
    }
  }

  return parts.map((t, i) => ({ index: i, text: t, chars: t.length }));
}

/**
 * Reassemble clauses into a prompt, omitting the given indices.
 * ONE joiner for baseline and variants alike, so the only difference between them is the clauses.
 */
export function render(clauses, omit = [], { joiner = '\n' } = {}) {
  const drop = new Set(omit.map(Number));
  return clauses.filter(c => !drop.has(c.index)).map(c => c.text).join(joiner);
}

/** The baseline: every clause, rendered the same way the variants are. Never the raw input. */
export const baselineOf = (clauses, opts) => render(clauses, [], opts);

/**
 * Does re-rendering the untouched prompt change it? Reported rather than silently corrected, because
 * a large difference means the segmentation is losing something and the results should not be trusted.
 */
export function renderDrift(prompt, clauses, opts) {
  const raw = String(prompt == null ? '' : prompt);
  const rendered = baselineOf(clauses, opts);
  const norm = s => s.replace(/\s+/g, ' ').trim();
  return {
    identical: raw === rendered,
    sameIgnoringWhitespace: norm(raw) === norm(rendered),
    rawChars: raw.length, renderedChars: rendered.length,
    lostChars: norm(raw).length - norm(rendered).length,
  };
}

export default { VERSION, SPEC_VERSION, STRATEGIES, segment, render, baselineOf, renderDrift };
