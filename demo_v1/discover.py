from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / "estate"
OUTPUT = ROOT / "discovery_output.json"


def load_csv(path: Path):
    with path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def nonempty(values):
    return [v for v in values if v not in (None, "")]


def profile_table(path: Path):
    rows = load_csv(path)
    columns = list(rows[0].keys()) if rows else []
    profile = {"dataset": path.stem, "row_count": len(rows), "columns": {}}
    for col in columns:
        vals = nonempty([r[col] for r in rows])
        unique = set(vals)
        profile["columns"][col] = {
            "non_null": len(vals),
            "null_rate": round(1 - (len(vals) / max(1, len(rows))), 4),
            "distinct": len(unique),
            "uniqueness": round(len(unique) / max(1, len(vals)), 4),
            "samples": sorted(unique)[:5]
        }
    return rows, profile


def value_overlap(a_values, b_values):
    a, b = set(nonempty(a_values)), set(nonempty(b_values))
    if not a or not b:
        return 0.0, 0.0, 0
    common = a & b
    # Directional coverage is useful for FK -> PK inference.
    return len(common) / len(a), len(common) / len(b), len(common)


def main():
    tables = {}
    profiles = []
    for path in sorted(DATA.glob("*.csv")):
        rows, profile = profile_table(path)
        tables[path.stem] = rows
        profiles.append(profile)

    candidates = []
    names = sorted(tables)
    for i, left_name in enumerate(names):
        left_rows = tables[left_name]
        if not left_rows:
            continue
        for right_name in names[i + 1:]:
            right_rows = tables[right_name]
            if not right_rows:
                continue
            for left_col in left_rows[0]:
                for right_col in right_rows[0]:
                    left_vals = [r[left_col] for r in left_rows]
                    right_vals = [r[right_col] for r in right_rows]
                    left_cov, right_cov, common = value_overlap(left_vals, right_vals)
                    if common < 2:
                        continue
                    score = max(left_cov, right_cov)
                    # Require meaningful overlap, but retain imperfect/stale references.
                    if score >= 0.55:
                        candidates.append({
                            "left": f"{left_name}.{left_col}",
                            "right": f"{right_name}.{right_col}",
                            "left_coverage": round(left_cov, 4),
                            "right_coverage": round(right_cov, 4),
                            "common_distinct_values": common,
                            "score": round(score, 4)
                        })

    candidates.sort(key=lambda x: (-x["score"], -x["common_distinct_values"], x["left"], x["right"]))

    output = {
        "profiles": profiles,
        "candidate_relationships": candidates,
        "notes": [
            "This is intentionally a deterministic data-only baseline.",
            "Candidate relationships are not yet semantic truth.",
            "The next stage will add evidence from SQL, code and configuration, then ask an LLM to interpret bounded evidence bundles."
        ]
    }
    OUTPUT.write_text(json.dumps(output, indent=2), encoding="utf-8")

    print(f"Profiled {len(profiles)} datasets")
    print(f"Found {len(candidates)} candidate column relationships")
    for rel in candidates[:20]:
        print(f"{rel['score']:.2f}  {rel['left']}  <->  {rel['right']}")


if __name__ == "__main__":
    main()
