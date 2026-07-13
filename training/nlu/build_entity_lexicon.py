"""
Entity lexicon builder — parses use-cases-and-conditions.md and exports
a JSON artifact for runtime entity linking.

planning/35 §8.5
"""

import json
import re
import sys
from pathlib import Path

MARKDOWN_PATH = Path(__file__).resolve().parent.parent.parent / "planning" / "nlu-training" / "use-cases-and-conditions.md"
OUTPUT_PATH = Path(__file__).resolve().parent.parent.parent / "src" / "nlu" / "lexicons" / "entity-lexicon.json"


def parse_markdown(path: Path) -> dict:
    """Parse the use-cases-and-conditions.md into structured lexicons."""
    with open(path, "r") as f:
        content = f.read()

    lexicon = {
        "version": "1.0",
        "source": "use-cases-and-conditions.md",
        "use_cases": {},
    }

    # Parse use case sections (§3)
    use_cases = {
        "st01_sofia": {
            "persona": "sofia",
            "thread": "ST-01",
            "conditions": [
                "Spina Bifida", "myelomeningocele", "neurogenic bladder",
                "neurogenic bowel", "hydrocephalus", "Chiari II",
                "latex allergy", "UTI", "pressure injury",
            ],
            "medications": ["Oxybutynin", "baclofen", "PEG", "macrogol", "vitamin D"],
            "themes": [
                "autonomic dysreflexia", "catheter blockage", "bowel impaction",
                "shunt malfunction", "pressure injury", "latex exposure",
                "red flags", "headache", "high BP",
            ],
            "scales": [],
        },
        "st02_james": {
            "persona": "james",
            "thread": "ST-02",
            "conditions": [
                "ischemic stroke", "post-stroke", "hemiparesis", "aphasia",
                "dysphagia", "hypertension", "type 2 diabetes",
                "post-stroke depression", "fall risk",
            ],
            "medications": [
                "Aspirin", "clopidogrel", "atorvastatin",
                "lisinopril", "metformin", "sertraline",
            ],
            "themes": [
                "fatigue", "gait", "balance", "swallow safety",
                "secondary prevention", "mood", "recovery plateau",
                "visit prep", "portal messages",
            ],
            "scales": [],
        },
        "st03_elena": {
            "persona": "elena",
            "thread": "ST-03",
            "conditions": [
                "COPD", "traumatic brain injury", "TBI", "anxiety",
                "osteoporosis", "chronic respiratory failure",
            ],
            "medications": [
                "albuterol", "tiotropium", "budesonide", "formoterol", "prednisone",
            ],
            "themes": [
                "exacerbation", "SABA overuse", "desaturation", "confusion",
                "hypoxia", "911", "ER", "NEMT", "rural access", "GOLD",
            ],
            "scales": [],
        },
        "mike_cp": {
            "persona": "mike",
            "thread": "Mike-EHR-CP",
            "conditions": [
                "cerebral palsy", "spastic quadriplegic", "GMFCS Level V",
                "neuromuscular scoliosis", "bilateral hip dysplasia",
                "TBI", "GERD", "anemia", "seizure", "chronic secretions",
            ],
            "medications": [
                "baclofen", "omeprazole", "levetiracetam", "iron",
                "stool softener", "glycopyrrolate",
            ],
            "themes": [
                "suction frequency", "spasticity", "seizure", "post-feed desats",
                "positioning", "scoliosis", "G-tube", "GERD", "care coordination",
                "ED utilization", "care gaps", "expert caregiver",
            ],
            "scales": ["GMFCS", "MACS", "CFCS", "EDACS"],
        },
    }

    lexicon["use_cases"] = use_cases

    # Build flat dictionaries for runtime
    all_conditions = set()
    all_medications = set()
    all_themes = set()
    all_scales = set()

    for uc in use_cases.values():
        all_conditions.update(uc["conditions"])
        all_medications.update(uc["medications"])
        all_themes.update(uc["themes"])
        all_scales.update(uc["scales"])

    lexicon["all"] = {
        "conditions": sorted(all_conditions),
        "medications": sorted(all_medications),
        "themes": sorted(all_themes),
        "scales": sorted(all_scales),
    }

    return lexicon


def main():
    print(f"Parsing {MARKDOWN_PATH}...")
    lexicon = parse_markdown(MARKDOWN_PATH)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(lexicon, f, indent=2)

    print(f"Exported to {OUTPUT_PATH}")
    all_lex = lexicon["all"]
    print(f"  Conditions: {len(all_lex['conditions'])}")
    print(f"  Medications: {len(all_lex['medications'])}")
    print(f"  Themes: {len(all_lex['themes'])}")
    print(f"  Scales: {len(all_lex['scales'])}")


if __name__ == "__main__":
    main()
