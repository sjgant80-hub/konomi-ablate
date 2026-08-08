# konomi-ablate

### ▶ **Live: https://sjgant80-hub.github.io/konomi-ablate/**

How much of your system prompt is doing nothing — and what is that costing you every month?

[![witness](https://github.com/sjgant80-hub/konomi-ablate/actions/workflows/witness.yml/badge.svg)](https://github.com/sjgant80-hub/konomi-ablate/actions/workflows/witness.yml)

## The gap

Every prompt tool **scores** a prompt. None of them **delete a clause and measure**.

So system prompts accrete. Someone adds *"think step by step"* in March. Nobody ever removes it,
because removing it would mean proving it does nothing, and there was never a way to prove that. You
pay for those tokens on **every call, for the life of the product**.

```
Your prompt is about 95 tokens. 50 of them (53%) make no measurable difference,
and removing all 5 together was tested and held. That is about £6 a month at
40,000 calls.
```

That is a system-prompt bill nobody currently gets.

## Three ways this goes wrong — handled, not disclaimed

### 1 · A delta is not a finding

Removing a clause and watching the score drop by one means nothing on twenty items. Every verdict goes
through an **exact sign test**. Movement that doesn't beat a coin is `INCONCLUSIVE`, never `DEAD`.

| verdict | meaning |
|---|---|
| `DEAD` | Removal changed nothing measurable |
| `LOAD_BEARING` | Removal made it decisively worse |
| `HARMFUL` | Removal made it decisively **better** — the clause is hurting you |
| `PROTECTED` | Removal moved a protected axis; never deleted on a flat total |
| `INCONCLUSIVE` | Not enough evidence either way |

`HARMFUL` is a real verdict and nobody looks for it, because nobody deletes clauses to find out.

### 2 · Individually removable ≠ jointly removable ← the trap

This is the reason leave-one-out ablation is dangerous, and it's the reason this repo exists.

Take *"cite your sources"* and *"never state anything you cannot support"*. They overlap. Remove either
and the other carries the load — so **each looks free**. Remove both and grounding collapses.

Leave-one-out reports both as dead, because that is literally what it measured. The measurement is
correct; the conclusion people draw from it — *"so I can delete both"* — is not, and nothing in a
normal tool's output warns them.

So a candidate set is **never certified** until the joint variant has actually been run:

```
⚠  5 clauses are individually removable, which is NOT the same as removing them
   together — two clauses can each cover for the other. Until the joint run, this
   batch is not certified.

✗  each of these was removable alone, but removing all 5 together cost 26 points
   (p = 0.0000) — they were covering for each other
```

### 3 · A flat total hides a safety regression

Deleting a safety clause because the aggregate didn't budge is the same poison as choosing a
preference pair on aggregate score ([konomi-export](https://sjgant80-hub.github.io/konomi-export/)
refuses those). A clause whose removal moves a **protected axis** — `safety` or `grounding` by default
— is never `DEAD`, however flat the total is. The joint run is checked the same way: a batch that
breaks safety *only when removed together* is refused.

## The methodological trap in the segmentation

The obvious implementation compares the **raw** prompt against **rendered** variants. That silently
confounds the clause you removed with every whitespace difference introduced by reassembly — so a
prompt with unusual indentation shows every clause as load-bearing.

The baseline is therefore always rendered through the same path as the variants. `render(clauses, [])`
is the baseline, never the input string. `renderDrift()` reports the difference rather than hiding it,
because a large one means the segmentation is losing content and the results shouldn't be trusted.

## Usage

```js
import { plan, analyse } from './ablate.mjs';
import { headline } from './cost.mjs';

const p = plan(mySystemPrompt, { strategy: 'line' });   // line · bullet · sentence · block

// YOU run your eval on p.baseline.prompt and each p.variants[i].prompt.
// Scores are per item, in the same order — numbers, or konomi-rubric vectors
// (vectors additionally enable the protected-axis check).
const report = analyse(p, { baseline: [...], 'without-0': [...], … });

report.candidates   // individually removable
report.certified    // [] until the joint run is done and holds

// the joint run — the step nobody does
const p2 = plan(mySystemPrompt, { jointOmit: report.candidates });
headline(analyse(p2, results2), { callsPerMonth: 40000, pricePerMillion: 3 }).sentence
```

**Nothing here calls a model.** Your harness runs the evals and hands back scores. That keeps the
kernel pure, lets it work with any model or provider, and is what makes the significance test possible
at all.

## Why this needed the rest of the suite first

Ablation is meaningless without an eval harness. This works because
[konomi-rubric](https://sjgant80-hub.github.io/konomi-rubric/) grades, and the exact sign test is
vendored from [konomi-regress](https://sjgant80-hub.github.io/konomi-regress/) so a clause is never
deleted on noise. Building this a week earlier would have produced a plausible number with nothing
underneath it.

## Verification

```bash
node test.mjs        # 154 assertions
```

| kernel | killed | reviewed-equivalent | verdict |
|---|---|---|---|
| `segment.mjs` | 10 / 10 | 0 | clean outright |
| `ablate.mjs` | 46 / 49 | 3 | no test-theatre |
| `cost.mjs` | 9 / 13 | 4 | no test-theatre |

Every load-bearing claim here is a **refusal**, and a refusal is only proven by constructing the case
it must refuse — so the suite builds each one deliberately: visible churn that fails the sign test must
come back inconclusive; a clause that moves safety while the total stays flat must never be dead; two
clauses individually dead and jointly disastrous must have their batch refused.

The four `cost.mjs` baselines are `roundMoney` breakpoints, confirmed **continuous over 200,000 values
with zero divergence** rather than argued from the source.

## Honest limits

- **This is only as good as your eval.** If your corpus doesn't discriminate, everything reads as dead
  — which is a finding about the corpus, and the tool says inconclusive rather than dead when nothing
  moved decisively.
- **The joint run tests one specific batch.** Certifying {A,B,C} says nothing about {A,B,D}.
  Interaction is combinatorial; this checks the set you actually propose to delete.
- **Token counts are estimated** at roughly ±20% unless you supply an exact tokeniser. The money figure
  is rounded to the precision that estimate supports, not printed to the penny.
- Ablation measures effect on *your* eval. A clause guarding against something your corpus never
  contains reads as dead and may still be load-bearing in production.

## The suite

[konomi-rubric](https://sjgant80-hub.github.io/konomi-rubric/) (grade) ·
[konomi-redteam](https://sjgant80-hub.github.io/konomi-redteam/) (attack) ·
[konomi-regress](https://sjgant80-hub.github.io/konomi-regress/) (compare) ·
[konomi-clean](https://sjgant80-hub.github.io/konomi-clean/) (is the data honest) ·
[konomi-judge](https://sjgant80-hub.github.io/konomi-judge/) (can a model grade it) ·
[konomi-export](https://sjgant80-hub.github.io/konomi-export/) (train without poisoning) ·
[konomi-canary](https://sjgant80-hub.github.io/konomi-canary/) (prove the set came first) ·
**konomi-ablate** (stop paying for dead prompt)

Gated by [witness](https://github.com/sjgant80-hub/witness). MIT.
