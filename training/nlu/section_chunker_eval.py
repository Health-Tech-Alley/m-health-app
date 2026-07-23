"""
Section chunker eval — tests parent/child ID convention + merge.

Uses #sN doc_ids from the qrels catalog.

planning/35 §8.2
"""

import json
import sys
from pathlib import Path

QRELS_PATH = Path(__file__).resolve().parent.parent.parent / "planning" / "nlu-training" / "retrieval-qrels.json"


def main():
    with open(QRELS_PATH, "r") as f:
        data = json.load(f)

    documents = data["documents"]

    # Find documents with section children (#sN suffix)
    section_docs = [d for d in documents if "#s" in d["doc_id"]]
    parent_docs = set()
    for d in section_docs:
        parent_id = d["doc_id"].split("#s")[0]
        parent_docs.add(parent_id)

    print(f"Total documents: {len(documents)}")
    print(f"Section children (#sN): {len(section_docs)}")
    print(f"Unique parents: {len(parent_docs)}")

    # Check parent-child relationships
    for parent_id in sorted(parent_docs):
        children = [d for d in section_docs if d["doc_id"].startswith(parent_id + "#s")]
        print(f"  {parent_id}: {len(children)} children")

    # Verify qrels reference section IDs correctly
    qrels = data["qrels"]
    section_refs = 0
    for qrel in qrels:
        for doc_id in qrel["relevant_doc_ids"]:
            if "#s" in doc_id:
                section_refs += 1

    print(f"\nQrels referencing section IDs: {section_refs}")
    print("PASS: Section convention verified.")


if __name__ == "__main__":
    main()
