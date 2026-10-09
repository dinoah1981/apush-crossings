# Writer brief: explanations + parallel questions

You are writing study content for an AP U.S. History practice app used by 11th graders at Comp Sci High, a non-selective public charter school in the South Bronx. Students answer a set of 8–10 multiple-choice questions. Then, **for each question they got wrong**, they must read your explanation, then answer your **parallel question** as a check for understanding. If they miss the parallel, they read its explanation and retry.

## Inputs
- Question bank: `C:\Users\david\apush-practice\data\apush-u1u2.base.json`. It has `stimuli` (keyed by id: text excerpts, images with alt text, tables), `questions` (num, topic, stimulus id, stem, choices, answer letter) and `sets` (lists of question nums).
- Topic guides (College Board AP Course and Exam Description, Units 1 and 2) as text: `C:\Users\david\apush-practice\source\unit1-topic-guide.txt` and `unit2-topic-guide.txt`. Use their learning objectives, historical developments and vocabulary to frame the context.
- Figures, if you want to look at them: `C:\Users\david\apush-practice\img\`.

## What to write, per question

### 1. `explanation`: one paragraph, 110–170 words
- Open with the **historical context**: who, what, when, where, why it mattered. Put it in plain, vivid language an 11th grader can follow. Define jargon the first time it appears (encomienda, mercantilism, Anglicization, headright, and so on).
- Then explain **why the right answer is right**. Tie it to the excerpt, image or table where there is one ("Anderson's numbers show…").
- Then say briefly **why the most tempting wrong answer(s) fail**. Refer to answers by their content, never by letter.
- Do not start with "The correct answer is…". No bullet points, no headings, a single paragraph.
- Where it helps, name the AP skill the question tests (sourcing/point of view, claims and evidence, causation, comparison, contextualization).

### 2. `parallel`: a new question that checks the same understanding
- It tests the **same concept and the same skill** as the original but is **not a rewording**. A student who only memorized the original answer should not get it free. A student who now understands the idea should.
- Exactly **4 choices** (A–D), each a plausible AP-style distractor. No "all/none of the above".
- **The correct letter must differ from the original question's correct letter.** Vary positions across your parallels.
- `stimulus`: either `null`, or the id of an existing stimulus in the bank. Reuse the original's stimulus when the original was a source-analysis question, and ask a different question about it. **Never invent quotations, statistics, tables, or attributed sources.** If you want a source, reuse one from the bank. Otherwise write a stimulus-free question (you can describe a situation in the stem itself).
- Match AP stem style ("Which of the following most directly…", "…best explains…").

### 3. `parallel.explanation`: 50–90 words
Why the parallel's answer is right and the strongest distractor is wrong. Students see it only if they miss the parallel, before retrying.

## Accuracy and tone
- Historical accuracy is non-negotiable. If you are unsure of a fact, leave it out.
- Use "enslaved people" / "enslaved Africans" in your own prose (sources may say otherwise). Write about Native nations and about slavery with precision and respect, not euphemism.
- Warm, direct, teacherly. No exclamation points, no "Great question".

## Answer-key check (important)
The key was written by a colleague, not taken from an official answer sheet. **Before reading the key for each question, answer it yourself.** If you disagree with the key, still write the explanation consistent with the key, but add an entry to `_keyFlags` with your answer, your confidence, and a 1–3 sentence reason. Flag only real disagreements, not ones you're merely unsure about.

## Output
Write **one JSON file per set** to `C:\Users\david\apush-practice\content\set<N>.json` (UTF-8, valid JSON, curly quotes allowed):

```json
{
  "5": {
    "explanation": "…",
    "parallel": {
      "stimulus": null,
      "stem": "…",
      "choices": ["…", "…", "…", "…"],
      "answer": "C",
      "explanation": "…"
    }
  },
  "_keyFlags": [ { "num": 33, "key": "D", "mine": "A", "confidence": "medium", "reason": "…" } ]
}
```

Include every question in your set(s). After writing, validate each file with Python (`json.load`), and check every question num is present, 4 parallel choices each, answer in A–D and different from the original's letter, and stimulus ids exist in the bank. Then reply with a brief summary: files written, plus any key flags.
