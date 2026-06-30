#!/usr/bin/env python3
"""Build the Simplified-Chinese name lookup for i18n.

Source: SCIM zh-Stable game data
(https://static.satisfactory-calculator.com/data/json/gameData/zh-Stable.json).

It only keeps the ids that actually appear in our normalized data pack
(data/data.normalized.json) and emits a compact JSON consumed at runtime by
src/i18n/names.ts:

    { "items": {id: 中文名}, "buildings": {...}, "recipes": {...} }

English names already live in data.normalized.json, so only the zh side is
generated here; missing ids fall back to English at runtime.

Usage:
    python3 data/build_zh_names.py            # fetch zh data from the CDN
    python3 data/build_zh_names.py <zh.json>  # use a local zh-Stable.json
"""
import json
import os
import sys
import urllib.request

ZH_URL = "https://static.satisfactory-calculator.com/data/json/gameData/zh-Stable.json"
HERE = os.path.dirname(os.path.abspath(__file__))
NORMALIZED = os.path.join(HERE, "data.normalized.json")
OUT = os.path.join(HERE, "..", "src", "i18n", "names.zh.json")


def load_zh(arg: str | None) -> dict:
    if arg:
        with open(arg, encoding="utf-8") as fh:
            return json.load(fh)
    print(f"Fetching zh game data from {ZH_URL} ...")
    with urllib.request.urlopen(ZH_URL) as resp:
        return json.loads(resp.read().decode("utf-8"))


def pick(zh_section: dict, ids) -> dict:
    out = {}
    for k in ids:
        name = zh_section.get(k, {}).get("name")
        if name:
            out[k] = name
    return out


def main() -> None:
    zh = load_zh(sys.argv[1] if len(sys.argv) > 1 else None)
    with open(NORMALIZED, encoding="utf-8") as fh:
        nd = json.load(fh)

    result = {
        "items": pick(zh.get("itemsData", {}), nd["items"].keys()),
        "buildings": pick(zh.get("buildingsData", {}), nd["buildings"].keys()),
        "recipes": pick(zh.get("recipesData", {}), nd["recipes"].keys()),
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=0, sort_keys=True)
        fh.write("\n")

    for kind in ("items", "buildings", "recipes"):
        total = len(nd[kind])
        got = len(result[kind])
        print(f"{kind}: {got}/{total} translated")
    print(f"wrote {os.path.relpath(OUT, HERE)}")


if __name__ == "__main__":
    main()
