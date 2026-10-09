"""Merge content/set*.json (explanations + parallel questions) into the base bank,
validate everything, and write the bank the app loads.

    python tools/merge_content.py
"""
import glob, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
base = json.load(open(ROOT / "data" / "apush-u1u2.base.json", encoding="utf-8"))

# Source fix: the booklet's bracket places Cahokia in Missouri; it is in Illinois.
r = base["stimuli"]["richter"]["paragraphs"]
r[0] = r[0].replace("[in present-day Missouri]", "[in present-day Illinois]")

content, flags = {}, []
for f in sorted(glob.glob(str(ROOT / "content" / "set*.json"))):
    d = json.load(open(f, encoding="utf-8"))
    flags += d.pop("_keyFlags", [])
    for k, v in d.items():
        content[int(k)] = v

errors = []
for q in base["questions"]:
    n, c = q["num"], content.get(q["num"])
    if not c:
        errors.append(f"Q{n}: no content"); continue
    p = c["parallel"]
    q["explanation"] = c["explanation"].strip()
    q["parallel"] = {"stimulus": p.get("stimulus"), "stem": p["stem"].strip(), "choices": [x.strip() for x in p["choices"]],
                     "answer": p["answer"], "explanation": p["explanation"].strip()}
    if len(p["choices"]) != 4: errors.append(f"Q{n}: parallel has {len(p['choices'])} choices")
    if p["answer"] not in "ABCD": errors.append(f"Q{n}: bad parallel answer {p['answer']}")
    if p.get("stimulus") and p["stimulus"] not in base["stimuli"]: errors.append(f"Q{n}: unknown stimulus {p['stimulus']}")
    if q["stimulus"] and q["stimulus"] not in base["stimuli"]: errors.append(f"Q{n}: unknown stimulus {q['stimulus']}")
    if q["answer"] not in "ABCDE"[: len(q["choices"])]: errors.append(f"Q{n}: answer out of range")
    for field in (q["explanation"], p["stem"], p["explanation"]):
        if len(field) < 40: errors.append(f"Q{n}: suspiciously short text")

if errors:
    print("\n".join(errors)); sys.exit(1)

out = ROOT / "data" / "apush-u1u2.json"
json.dump(base, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"wrote {out}: {len(base['questions'])} questions, all with explanations + parallels")
print("key flags:", flags or "none")
