"""Build data/apush-u1u2.base.json from the parsed booklet (raw.json).

One-time tool for this bank: stimuli, answer key, topic tags and sets are
defined here by hand. Explanations + parallel questions are merged in later
by tools/merge_content.py.

    python tools/build_base_bank.py <path/to/raw.json>
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
raw = {q["num"]: q for q in json.load(open(sys.argv[1], encoding="utf-8"))}

KEY = dict(zip(range(1, 74), (
    "B A B C A A C B A B "  # 1-10
    "B B C A D D C A A B "  # 11-20
    "A B A A C B B D C B "  # 21-30
    "B B D C B D A D D B "  # 31-40
    "C C B C D B C D C B "  # 41-50
    "C B C C B D D C C D "  # 51-60
    "B E A A A A B A E C "  # 61-70
    "B C A"                 # 71-73
).split()))

TOPICS = [
    ("1.2", 1, "Native American Societies Before European Contact"),
    ("1.3", 1, "European Exploration in the Americas"),
    ("1.4", 1, "Columbian Exchange, Spanish Exploration, and Conquest"),
    ("1.5", 1, "Labor, Slavery, and Caste in the Spanish Colonial System"),
    ("1.6", 1, "Cultural Interactions Between Europeans, Native Americans, and Africans"),
    ("2.2", 2, "European Colonization"),
    ("2.3", 2, "The Regions of British Colonies"),
    ("2.4", 2, "Transatlantic Trade"),
    ("2.5", 2, "Interactions Between American Indians and Europeans"),
    ("2.6", 2, "Slavery in the British Colonies"),
    ("2.7", 2, "Colonial Society and Culture"),
]
TOPIC_OF = {}
for t, nums in {
    "1.2": [5, 8, 19, 20], "1.3": [21, 22, 24], "1.4": [25, 27],
    "1.5": [2, 23, 28, 29, 30, 31], "1.6": [26, 33, 34],
    "2.2": [15, 35, 36, 42],
    "2.3": [1, 3, 4, 9, 10, 18, 41, 43, 44, 45, 46, 47, 66, 71],
    "2.4": [11, 12, 16, 17, 50, 51, 52, 53, 73],
    "2.5": [13, 14, 37, 38, 39, 40, 54, 55, 56],
    "2.6": [32, 48, 49, 57, 58, 59, 60, 61, 62, 63, 64, 65],
    "2.7": [6, 7, 67, 68, 69, 70, 72],
}.items():
    for n in nums:
        TOPIC_OF[n] = t
assert len(TOPIC_OF) == 73

SETS = [
    ("Before & After 1492", "Native societies, why Europeans came, and how Spain conquered.",
     [5, 8, 19, 20, 21, 22, 23, 24, 25, 27]),
    ("Labor, Caste & Collision in New Spain", "Encomienda, slavery, the casta system, and the debate over Native rights.",
     [2, 28, 29, 30, 31, 26, 33, 34]),
    ("Founding the Colonies & the Chesapeake", "Why Europeans colonized, and how tobacco built Virginia.",
     [15, 36, 42, 35, 43, 46, 47, 18, 45]),
    ("Puritan New England", "Covenant communities, families, and the dissenters who challenged them.",
     [1, 3, 4, 9, 10, 41, 44, 66, 71]),
    ("The Atlantic Economy & Mercantilism", "Trade networks, the Navigation Acts, and the empire of goods.",
     [11, 12, 16, 17, 50, 51, 52, 53, 73]),
    ("Native Americans & Colonists", "War, alliance, trade, and land: Bacon, Metacom, the French and the Dutch.",
     [13, 14, 37, 38, 39, 40, 54, 55, 56]),
    ("Slavery Takes Root", "How racial slavery became law and how enslaved people resisted.",
     [48, 49, 60, 63, 65, 64, 59, 58, 61, 62]),
    ("Awakening, Ideas & Colonial Culture", "The Great Awakening, a free press, and African cultures in America.",
     [6, 7, 67, 68, 69, 70, 72, 57, 32]),
]
assert sorted(n for s in SETS for n in s[2]) == list(range(1, 74))


def clean(s):
    s = s.replace(" ", " ").replace(" ", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def text_stim(paras, source):
    return {"type": "text", "paragraphs": [clean(p) for p in paras if clean(p)], "source": clean(source)}


def split_quote(block):
    """'“para1 “para2” Source' -> (paragraphs, source)."""
    block = clean(block)
    end = block.rfind("”")
    body, source = block[: end + 1], block[end + 1 :].strip(" -—")
    paras = ["“" + p if not p.startswith("“") else p for p in re.split(r"\s(?=“)", body)]
    return paras, source


stimuli, stim_of, stems = {}, {}, {}

# Stimuli that sit before the question (from parsed preambles)
def pre_stim(sid, num, drop=0):
    lines = [l for l in raw[num]["pre"] if not l.startswith("Question refers")]
    stimuli[sid] = text_stim(lines[:-1] if not drop else lines[:-drop], lines[-1] if not drop else " ".join(lines[-drop:]))

pre_stim("anderson", 3)
pre_stim("cole", 6)
pre_stim("winthrop", 9)
pre_stim("bender", 11)
pre_stim("tenochtitlan", 25, drop=2)
pre_stim("gitlin", 39)
pre_stim("navact1660", 52)
pre_stim("randolph", 54)
pre_stim("franklin", 67)
for sid, nums in {"anderson": [3, 4], "cole": [6, 7], "winthrop": [9, 10], "bender": [11, 12],
                  "tenochtitlan": [26], "gitlin": [39, 40], "navact1660": [52, 53],
                  "randolph": [54, 55], "franklin": [67, 68]}.items():
    for n in nums:
        stim_of[n] = sid

# Stimuli embedded in the question body: split at the start of the actual question
EMBEDDED = {
    19: ("richter", "Which of the following best characterizes"),
    20: ("kupperman", "Which of the following contributed most"),
    21: ("cortes", "The interaction between Cort"),
    30: ("lascasas1552", "Which of the following most directly resulted"),
    32: ("furstenberg", "Which of the following aspects of colonial"),
    33: ("lascasas1550", "Which of the following describes a piece"),
    34: ("degante", "In the third paragraph of the excerpt"),
    41: ("mayflower", "Participation in the"),
    42: ("smith", "Smith’s account of the hardships"),
    47: ("woloch", "Which of the following demographic patterns"),
    51: ("navact1696", "The excerpt most directly reflects"),
    56: ("spotswood", "The point of view expressed"),
    64: ("jones", "The development described in the excerpt"),
    65: ("valaws", "The laws excerpted most directly"),
    66: ("hutchinson", "The excerpts from Anne Hutchinson"),
    70: ("edwards", "The quote above is an example"),
    73: ("stiglitz", "Which of the following earlier trends"),
}
for n, (sid, marker) in EMBEDDED.items():
    stem = clean(raw[n]["stem"]).replace("Question refers to the excerpt below. ", "")
    i = stem.find(marker)
    assert i > 0, (n, marker)
    paras, source = split_quote(stem[:i])
    stimuli[sid] = {"type": "text", "paragraphs": paras, "source": source}
    stim_of[n] = sid
    stems[n] = stem[i:]

# The two Virginia laws are separate quotes with their own sources
stimuli["valaws"] = {"type": "text", "paragraphs": [
    "“Children [born to] an Englishman [and] a Negro woman shall be bond or free according to the condition of the mother.” — Laws of Virginia, Act XII, adopted in 1662",
    "“Negroes or Indians, though baptized and enjoying their own freedom, shall be incapable of purchasing Christians, yet they are not debarred from buying any of their own color.” — Laws of Virginia, Act V, adopted in 1670",
], "source": "Laws of Virginia, 1662 and 1670"}
# Edwards quote has no source line in the booklet (identifying it is the question)
stimuli["edwards"]["source"] = ""
stimuli["mayflower"]["source"] = stimuli["mayflower"]["source"].replace(" ", " ")

# Images
IMAGES = {
    2: ("img-africans", "img/q02-africans-graph.png",
        "Bar graph titled Number of Africans Transported to the New World, 1450 to 1900. Approximate values: 1450-1600, about 400,000; 1601-1700, about 1.3 million; 1701-1800, about 6 million; 1801-1900, about 3.4 million.",
        ""),
    8: ("img-density", "img/q08-population-map.png",
        "Map titled American Indian Population Density in 1500, shaded from low to high. The highest density (black) covers central and southern Mexico, Central America, and the Caribbean islands; moderate density appears along the Pacific coast, the Southeast, and the Northeast coast; the Great Plains and far north are low.",
        ""),
    22: ("img-sugar", "img/q22-sugar-engraving.jpg",
         "Engraving showing enslaved Africans working at a sugar mill: cutting cane, carrying bundles, feeding a water-powered press, and boiling cane juice in large kettles.",
         "Engraving of sugar production on a plantation in the Spanish Caribbean, 1595, Theodor de Bry. © The Library Company of Philadelphia"),
    24: ("img-spain1640", "img/q24-spanish-empire-map.png",
         "Map titled Spanish Empire in the Americas in 1640, showing Spanish territory across Mexico, Central America, the Caribbean, and western and southern South America, with symbols marking gold, silver, and sugar sites.",
         "Spanish Empire in the Americas in 1640"),
    38: ("img-settlements", "img/q38-settlements-map.png",
         "Map titled Extent of European Settlements, Circa 1740, showing British colonial settlement as a band along the Atlantic coast from New Hampshire to South Carolina, east of the Appalachian Mountains, with New France to the north and west.",
         "Extent of European Settlements, Circa 1740"),
}
for n, (sid, src, alt, cap) in IMAGES.items():
    stimuli[sid] = {"type": "image", "src": src, "alt": alt, "caption": cap}
    stim_of[n] = sid
stim_of[23] = "img-sugar"
stems[24] = clean(raw[24]["stem"]).replace("Spanish Empire in The Americas in 1640 ", "")
stems[38] = clean(raw[38]["stem"]).replace("Extent of European Settlements, Circa 1740 ", "")

# Tables
stimuli["tbl-exports"] = {"type": "table", "title": "Value of Selected Goods Exported to British North America from England",
    "note": "£ = British pounds, a form of currency",
    "head": ["Good", "1699", "1749"],
    "rows": [["Wool textiles", "£95,200", "£359,700"], ["Linen textiles", "£11,300", "£115,600"],
             ["Leather", "£14,200", "£12,100"], ["Iron", "£25,300", "£110,000"],
             ["Other manufactures", "£79,500", "£125,400"], ["Cheese and foodstuffs", "£2,300", "£5,400"]]}
stimuli["tbl-population"] = {"type": "table", "title": "British Colonial Population, 1660 and 1710", "note": "",
    "head": ["British Colonial Region", "Black Inhabitants in 1660", "Black Inhabitants in 1710", "White Inhabitants in 1660", "White Inhabitants in 1710"],
    "rows": [["New England", "562", "2,585", "33,006", "115,094"], ["Middle Colonies", "630", "6,218", "4,846", "63,374"],
             ["Chesapeake", "1,708", "31,063", "33,738", "89,959"], ["Carolinas", "20", "5,000", "980", "21,003"],
             ["West Indies", "32,932", "136,645", "36,639", "31,729"]]}
for n in (16, 17):
    stim_of[n] = "tbl-exports"
for n in (48, 49):
    stim_of[n] = "tbl-population"

questions = []
for n in range(1, 74):
    q = raw[n]
    stem = stems.get(n, clean(q["stem"]))
    choices = [clean(c) for c in q["choices"]]
    assert KEY[n] in "ABCDE"[: len(choices)], n
    questions.append({"num": n, "topic": TOPIC_OF[n], "stimulus": stim_of.get(n), "stem": stem,
                      "choices": choices, "answer": KEY[n]})

bank = {
    "id": "apush-u1u2",
    "title": "APUSH Units 1–2 Practice",
    "subtitle": "Periods 1–2 · 1491–1754",
    "course": "AP U.S. History",
    "lockSets": True,
    "topics": [{"id": t, "unit": u, "title": title} for t, u, title in TOPICS],
    "sets": [{"id": i + 1, "title": t, "blurb": b, "questions": nums} for i, (t, b, nums) in enumerate(SETS)],
    "stimuli": stimuli,
    "questions": questions,
}
out = ROOT / "data" / "apush-u1u2.base.json"
out.parent.mkdir(exist_ok=True)
json.dump(bank, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("wrote", out, len(questions), "questions,", len(stimuli), "stimuli")
