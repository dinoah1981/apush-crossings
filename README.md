# Crossings: APUSH practice

A static, gamified multiple-choice practice site. It runs on GitHub Pages and records every answer to a Google Sheet.

**How a set works:** students answer 8–10 questions grouped by topic. They see right or wrong, but not the answer. In the **debrief** they must read a paragraph of context for each question they missed; the "Got it" button stays locked until they've had time to read. Then a **check** gives them a parallel question for each miss, and they retry until they get it right. Every attempt is logged.

**Review all:** every finished set gets a "Review all explanations" button (on its map card and the set-complete screen) listing each question with the answer, the explanation, and what the student chose on their latest run. No timers, nothing scored.

**Short answer models:** a bank can carry `saqs` (short-answer questions with a model answer per part, plus other answers that also earn credit). They appear after the sets as read-only stops: students read, the "I've read the models" button unlocks after a reading timer, and the read is logged to Set Results as `SAQ <n>` with score 1/1.

**Game layer:** XP (+10 per correct answer, a streak bonus from 3 in a row, XP for checks, set-complete and flawless-set bonuses), nine ranks (Stowaway → Chronicler), a voyage map where each set unlocks the next, a topic-mastery chart (1.2–2.7), and a class leaderboard (first name + last initial). Practice replays of finished sets are logged but earn no XP.

## Password wall

The question bank is published only in encrypted form (`data/apush-u1u2.enc.json`, AES-256-GCM, key derived from the class password). Visitors see a password screen first; the questions and answer key can't be read without it, even by fetching the file directly. Each device remembers the unlock, so students enter it once. The plaintext bank (`data/apush-u1u2.json`) and the writer drafts (`content/`) live only on your computer and are gitignored.

**To change the password** (or after editing the bank), re-encrypt and push:
```
python tools/merge_content.py          # only if content/ changed
python tools/encrypt_bank.py data/apush-u1u2.json data/apush-u1u2.enc.json
```
A new password automatically logs every device out of the old one.

The images in `img/` are not encrypted; without the questions they don't give anything away.

## One-time setup: the results sheet (about 5 minutes)

1. Create a new Google Sheet (e.g. "APUSH Crossings Results").
2. **File → Import → Upload** your roster CSV (`AP US History.4 Roster 2026-09-07.csv`). Choose **Insert new sheet(s)**, then rename that tab to **`Roster`**. The script reads the `First Name`, `Preferred Name`, `Last Name` and `School ID` columns (OSIS).
3. **Extensions → Apps Script.** Delete the starter code and paste in all of `apps-script/Code.gs`. Save.
4. In the function dropdown pick **`setup`**, then **Run**. Approve the permissions prompt. This creates the Responses, Set Results, Students and Summary tabs and confirms the roster count.
5. **Deploy → New deployment →** gear icon **→ Web app**. Set *Execute as:* **Me** and *Who has access:* **Anyone**. Deploy and copy the URL ending in `/exec`.
6. Paste that URL into `config.js` as `scriptUrl`, then commit and push.

Until step 6, the site runs in **demo mode**: anyone can sign in and nothing is saved.

If you later edit `Code.gs`, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.

## What lands in the sheet

| Tab | One row per… | Columns |
|---|---|---|
| Responses | answer (main question or parallel check attempt) | timestamp, OSIS, last, first, set, phase, question #, topic, chosen, correct answer, correct?, attempt |
| Set Results | finished set | score, out of, %, missed question #s, check attempts, XP earned, total XP, replay? |
| Students | student | XP, rank, sets done, last active, saved progress (lets a student switch devices) |
| Summary | student | best first-try % per set (pivot formula, ignores replays) |

**Privacy:** no names or OSIS numbers are in the website. A student types their name; the script matches it against the Roster tab and returns an opaque key. The roster never leaves your sheet. The leaderboard shows first name + last initial only.

**Known limits:** anyone who knows a classmate's name could sign in as them. The answer key sits in the page data, so a determined student could find it in the browser's dev tools. This is fine for practice, not for graded assessment.

## Adding another question bank later

1. Create a bank JSON in `data/` with the same shape as `data/apush-u1u2.json` (local only), then encrypt it with `tools/encrypt_bank.py`:
   - `topics`: `[{id, unit, title}]`
   - `sets`: `[{id, title, blurb, questions: [nums]}]`
   - `stimuli`: `{id: {type: "text", paragraphs, source} | {type: "image", src, alt, caption} | {type: "table", title, head, rows, note}}`
   - `questions`: `[{num, topic, stimulus, stem, choices, answer, explanation, parallel: {stimulus, stem, choices, answer, explanation}}]`
   - `saqs` (optional): `[{id, title, blurb, stimulus, intro, parts: [{label, prompt, model, alsoCredit: [..]}]}]`
2. Add the `.enc.json` file to `banks` in `config.js`. A bank picker appears on the home screen, and `?bank=<id>` links straight to it. Progress and XP are tracked per bank, and the sheet's Bank column keeps them apart.

To produce a bank from a new PDF, the pipeline used here is in `tools/`:
- A per-bank build script (questions, stimuli, key, topic tags, sets). It contains the answer key, so it lives in the gitignored `content/` folder (e.g. `content/u1u2/build_base_bank.py`, `content/u2pc/build.py`), never in `tools/`.
- `WRITER_BRIEF.md`: the spec for writing explanations and parallel questions.
- `merge_content.py`: merges and validates `content/set*.json` into the final bank.

Easiest path: give Claude the question PDF, the answer key and the topic guides, and ask it to build a new bank following this README.

## Local preview

```
python -m http.server 8790
```
Then open http://localhost:8790.
