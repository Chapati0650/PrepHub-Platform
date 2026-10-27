# Importing a practice test through Claude

The website's bulk upload (Owner → Content → Bulk upload) sends every page of
a PDF to the DeepSeek/Anthropic API to be read, classified, answered and
explained, and the Owner pays for those tokens. This folder does the same job
with Claude doing the reading in a Claude Code session, so the API is not used.
The result is the same: AI-generated Draft questions in the Questions table,
ready to review in Student Preview and publish.

**Test PDFs and their transcriptions never go in this repository.** The repo
is public, and practice tests belong to their publishers. Each test gets a
folder under `C:\Users\neele\Downloads\PrepHub\Question imports\`.

## The workflow

1. **The Owner** puts the PDF in a new folder there, e.g.
   `Question imports\Bluebook Test 4\test.pdf`, and asks Claude to import it.
2. **Render the pages** (same scale as the website, so figures crop the same):
   `node scripts/question-import/render-pages.mjs "<folder>\test.pdf" "<folder>\pages"`
3. **Transcribe** every question into `<folder>\questions.json`, following
   the rules below. For a full test, split the work by module across helper
   agents (each writes its own part, then the parts are merged), so no single
   context has to hold all eighty pages. Look at the page images, not the
   PDF's text layer: underlines, figures and math live in the picture.
   Each question also gets its **walkthrough** (see "Walkthroughs" below),
   written by the same helper right after its explanation.
4. **Check**: `npx tsx scripts/question-import/import.ts "<folder>"`. It
   validates every question, reports any already in the bank, and crops every
   figure into `<folder>\figures\`. **Look at every crop** and adjust the box
   until each one holds the whole figure and nothing else.
5. **Import into the local database first** (`--commit`) and open a few in the
   local CMS's Student Preview, especially ones with passages, underlines,
   math, money or figures. Delete them afterwards.
6. **Import into production** only with the Owner's go-ahead for that batch:

   ```
   NEON="$(grep -E '^DATABASE_URL=' .env.neon | cut -d= -f2-)"
   DATABASE_URL="$NEON" npx tsx --env-file=.env.r2 scripts/question-import/import.ts "<folder>" --production --commit
   ```

   `.env.r2` is a gitignored file the Owner fills with the four `R2_*` values
   from Netlify. Never print it. Without it, figure images would be stored on
   this computer and the live site couldn't show them, so the script refuses
   to import a batch with figures into production without it.

   Questions arrive as Drafts, exactly like the website's bulk upload. Add
   `--publish` only when the Owner asks for them to go live directly.

## `questions.json`

```json
{
  "source": "Bluebook Practice Test 4",
  "questions": [
    {
      "ref": "RW1-01",
      "pages": [3],
      "questionType": "MULTIPLE_CHOICE",
      "category": "VOCABULARY",
      "difficulty": "EASY",
      "difficultyReasoning": "Single context clue directly defines the blank.",
      "passageText": "The architect's design was praised for being ______: …",
      "questionText": "Which choice completes the text with the most logical and precise word or phrase?",
      "choices": ["ornate", "functional", "whimsical", "temporary"],
      "correctChoiceIndex": 1,
      "acceptedAnswers": [],
      "answerConfidence": "high",
      "answerReasoning": "Every element served a purpose and nothing was decorative → functional.",
      "answerKey": "B",
      "explanationSteps": ["…", "…"],
      "distractorExplanations": ["…", null, "…", "…"],
      "figure": null,
      "walkthrough": { "version": 1, "panels": [], "steps": [] }
    }
  ]
}
```

- `ref` is the test's own label: section, module, number (`RW1-07`, `M2-14`).
- `pages` are 1-based page numbers of the rendered images the question uses.
- `answerKey` is what the test's own answer key says, or `null` if the PDF
  has none. When it disagrees with your answer the import refuses the
  question: settle it before importing (re-read the question; a transcription
  slip is the usual cause), and tell the Owner about any real disagreement.
- `distractorExplanations` lines up with `choices`, with `null` at the
  correct answer. Grid-ins use `null` for it, `choices` and
  `correctChoiceIndex`, and put every accepted form in `acceptedAnswers`
  (`["0.5", "1/2", ".5"]`).
- `figure` is `{ "page": 7, "box": [left, top, right, bottom] }` on a 0–1000
  scale of that page image (top-left is 0,0), as the website's transcription
  uses. Box the whole graph, chart, table or diagram, with its axis labels,
  legend and title, plus a small margin, and none of the question text or
  choices. A table that is plain rows of numbers may be typed in the question
  text instead, but a figure must never be described in words in its place.

## Transcription rules (the website's own, `src/lib/content/transcribe.ts`)

- **Exactly as written.** Don't rephrase, correct or add anything.
- **Math in `$…$`** inline or `$$…$$` for a displayed equation. It is the
  only math syntax the site renders: `x^2` without delimiters shows as the
  characters `x^2`. Use LaTeX inside (`$\frac{3}{4}$`, `$x^2$`, `$\sqrt{2}$`,
  `$\pi$`, `$\le$`, `$\overline{AB}$`, `$\angle ABC$`, `$45^\circ$`).
- **Money is `\$`**: `costs \$4.50 each`, or `$\$4.50$` inside math. A bare
  `$` starts math. (The renderer learned `\$` on 2026-10-26; before that,
  prices broke the question.)
- **Every backslash is doubled in the JSON file**: `"$\\frac{1}{2}$"`,
  `"\\$4"`. A single one is a JSON escape that parses without error:
  `\frac` becomes a form feed, `\times` a tab, `\neq` a line break. The check
  flags control characters and line breaks inside math for this reason.
- **Line breaks** (`\n`) render as breaks: notes as `• ` lines, poems line by
  line, `Text 1`/`Text 2` blocks separated by a blank line. There is no
  italic syntax, so titles and species names are plain text.
- **Tables**: a math table in the stem is a KaTeX array in `$$…$$`; a table
  that *is* an answer choice must be typed the same way inside `$…$`,
  because choices can't carry images. A data table in a Reading passage is
  the figure.
- **Underlined text in `[[…]]`**, even across sentences. Many Reading &
  Writing questions ask about "the underlined portion" and are unanswerable
  without it, so look for underlines carefully.
- **Reading & Writing**: the passage (or passages, or notes) goes in
  `passageText`; the question line ("Which choice…") goes in `questionText`.
  The site shows them side by side. Keep paragraph breaks as blank lines, and
  "Text 1"/"Text 2" labels as written.
- **Math**: `passageText` is `null`; the whole stem is `questionText`.
- **Choices** without their "A)" labels, in order.
- **Questions that cross a page** are transcribed whole (the website has to
  skip these, because it sees one page at a time).
- Skip covers, directions, blank pages, and the answer key itself (but use the
  key for `answerKey`).

## Category (the website's rule, `classify-category.ts`)

By the skill being tested, not incidental wording:

- **READING_COMPREHENSION**: meaning, evidence, central idea, structure,
  purpose, inference, cross-text, quantitative evidence from a passage.
- **GRAMMAR**: sentence boundaries, punctuation, verb form and agreement,
  pronouns, modifiers, transitions, rhetorical synthesis from notes.
- **VOCABULARY**: words in context ("most logical and precise word or
  phrase", "as used in the text, … most nearly means").
- **ALGEBRA**: linear equations, inequalities, systems, linear functions.
- **ADVANCED_MATH**: quadratics, polynomials, exponentials, nonlinear
  functions, equivalent expressions.
- **PROBLEM_SOLVING_DATA_ANALYSIS**: ratios, rates, percentages, units,
  statistics, probability, data in tables and graphs.
- **GEOMETRY_TRIGONOMETRY**: lines, angles, triangles, circles, area and
  volume, right-triangle trigonometry.

## Difficulty (the website's rubric, `classify-difficulty.ts`)

As the SAT calibrates it, by steps and depth, not length:

- **EASY**: one or two straightforward steps, one concept, tested directly.
- **MEDIUM**: a couple of concepts or several steps, with room for a
  careless slip.
- **HARD**: multi-step reasoning, an unusual approach, or a precise grasp of
  a nuanced idea.

A Bluebook module 2 marked harder is a hint, not the answer. But when the PDF
labels each question Easy/Medium/Hard itself (as compiled question-bank
exports do), use its label: it is the source's calibration, not a guess.
Give the reason in `difficultyReasoning`, which is shown only to the
reviewer.

## The answer

Solve every question yourself and compare with the key. `answerConfidence`
is honest: `high` only when certain. `answerReasoning` is terse working for
the reviewer, not students.

## Explanations (the website's style, `generate-explanation.ts`)

- Brilliant.org-style numbered steps; **each step does exactly one thing**
  (one substitution, one manipulation, one conclusion). Most questions need
  4–8 steps. Don't compress to keep the count down.
- Explain why the correct answer is right, using the same `$…$`, `\$` and
  `[[…]]` rules.
- **Distractor notes** (one short note per wrong choice): name the specific
  slip that leads there (a sign error, stopping a step early, answering a
  nearby question, misreading the passage), or say plainly that it matches no
  common mistake and point at the concept to review. Don't invent a mistake
  that probably isn't real.

## Walkthroughs (every question gets one)

A walkthrough turns the explanation into a step-through: Back / Next over a
stage of panels, with each explanation step as the narration. It is data in
the question's `walkthrough` field, validated by the check and drawn by the
site's own components (`src/components/content/walkthrough/`), so it costs
nothing per student. Write it **after** the explanation steps, because it has
exactly one entry per step and must show what that step's text says.

```json
"walkthrough": {
  "version": 1,
  "panels": [{ "type": "passage" }, { "type": "choices" }],
  "steps": [
    { "passage": { "highlight": ["Few economists would have predicted"] } },
    { "choices": { "eliminate": [1, 3] } },
    { "passage": { "fill": { "text": "forecast", "verdict": "right" } }, "choices": { "eliminate": [0], "reveal": true } }
  ]
}
```

Each step is keyed by panel id (a panel's id is its type unless you give it
one). **Highlights and focus last one step; crossed-out choices, added
working, shown elements and set values carry forward.**

### Panels

| type | what it is | a step can say |
|---|---|---|
| `passage` | the question's own passage (never copy it) | `highlight` / `alt`: exact quotes, cyan / amber; `fill`: `{ text, verdict? }` puts text in the blank (`"right"` green, `"wrong"` red wavy), carries forward, `null` clears |
| `choices` | the question's own choices | `focus`: index ("Checking"); `eliminate`: indices ("Ruled out"); `reveal: true` marks the answer green |
| `work` | lines of math, KaTeX, no `$` | `add`: lines; `clear: true`. `\hl{…}` / `\hlalt{…}` mark what this step changed; `\cancel{…}` works |
| `vars` | small "known so far" chips | `{ "name": "value" }` sets (LatexText, `$…$` allowed), `null` removes |
| `plane` | coordinate grid: `x`, `y` ranges, `tick`, `labelEvery`, `xLabel`, `yLabel`, `elements` | `show` / `hide` / `focus`: element ids |
| `diagram` | free drawing, `width` × `height`, y points **down** | `show` / `hide` / `focus` |
| `numberline` | `min`, `max`, `tick`, `elements`; always full width, so list it first | `show` / `hide` / `focus` |
| `table` | `title`, `header`, `rows` (LatexText cells) | `rows`, `cols`, `cells: [[r, c]]` |
| `bars` | `title`, `categories`, `series: [{ name, values, shade? }]`, `yMax`, `yLabel` | `focus`: a category index, or `[series, category]` |

Elements (each has an `id`; `hidden: true` starts it off-stage for a later
`show`):

- **plane**: `point {at, label}`, `line {through: [p, q], label, dashed}` (infinite),
  `segment {from, to, label, dashed, arrow}`, `curve {points}` (sample a
  function at enough x-values to look smooth), `region {points}` (shaded
  polygon, for inequalities), `label {at, text}`.
- **diagram**: `point {at, label, labelAt: n/s/e/w/ne/nw/se/sw}`, `segment`,
  `polygon {points, filled}`, `circle {center, r, filled, cutout}` (a cutout
  circle drawn over a filled one is a hole: a pipe, a washer), `angle {vertex,
  from, to, label, right}`, `label {at, text}`.
- **numberline**: `point {at, open, label}`, `interval {from, to, openFrom,
  openTo}` (`null` runs off that end), `label {at, text}`.

Figure labels take a small math subset inside `$…$`: italics, `^`, `_`,
`\frac`, `\sqrt`, `\circ`, `\pi`, `\le`/`\ge`/`\ne`, `\approx`, `\cdot`,
`\times`, `\angle`, `\ell`. Put anything heavier in the working panel.

### What makes one good

- **Every step changes something on the stage, and it is the thing the
  narration names.** "The table gives 71.2% at site GC" lights that row; "the
  slope is 5" adds that line with the 5 marked. A step with nothing to show
  adds a `vars` chip or re-focuses what it is talking about.
- **Focus, don't decorate.** Focusing elements dims the rest, which is what
  makes a step readable at a glance. Focus the two or three things the step
  is about, including the points a calculation uses.
- **Redraw the figure, don't describe it.** A graph, chart, table or diagram
  in the question is rebuilt as a panel with the same numbers and labels.
  When the explanation names the source's colours ("the gray bar"), set
  `shade` to match. A diagram can be a more useful view than the original
  (the pipe's cross-section rather than its side): say "not to scale".
- **The choices panel ends with `reveal: true`** (the check requires it).
  Cross choices out at the step whose reasoning rules them out, never the
  correct one (the check refuses that too). A grid-in has no choices panel.
- **Reading & Writing**: `passage` + `choices`. Highlight the words each step
  quotes; `alt` for the contrasting evidence. Quotes are copied exactly from
  the passage, curly quotes included, and can't cross the edge of an
  `[[underline]]` or math (split them in two). Vocabulary and grammar fill the
  blank: try a wrong choice with `"verdict": "wrong"`, then the right one.
  Notes questions highlight the bullet that answers the goal.
- **Math**: `work` beside a `plane`, `diagram`, `numberline` or `table`, plus
  `choices`. The working is the explanation's equations, one line per step,
  with `\hl{}` on what changed. Use `vars` for the givens and results a
  student should keep in view (`$R$ = 30 in`).
- **Layout** follows the panel count: two panels sit side by side when there
  is room, an odd one out takes the full width, `vars` sits beside the
  narration. Three to four panels is plenty.
- Local WIN1252 rule applies to stored text: write math in LaTeX, not
  Unicode symbols.

The check validates every walkthrough against its question (step count,
quotes, indices, element ids, KaTeX, coordinates in range). To add
walkthroughs to questions **already in the bank**, put them in that test's
`questions.json` and run the same import with
`--commit --attach-walkthroughs`: questions that exist get their walkthrough
(checked against the content actually stored), nothing else is created.
