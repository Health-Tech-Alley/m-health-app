"""
JSONL exporter — flattens utterances JSON to JSONL for external tools.

Optional convenience script.
"""

import json
import sys
from pathlib import Path

UTTERANCES_PATH = Path(__file__).resolve().parent.parent.parent / "planning" / "nlu-training" / "utterances-800.json"
OUTPUT_PATH = Path(__file__).resolve().parent / "utterances-800.jsonl"


def main():
    with open(UTTERANCES_PATH, "r") as f:
        data = json.load(f)

    with open(OUTPUT_PATH, "w") as f:
        for u in data["utterances"]:
            f.write(json.dumps(u) + "\n")

    print(f"Exported {len(data['utterances'])} utterances to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
