"""Discover MasterChef AU recipe URLs across all sources we know work:

  - /masterchef/participants    (current season summary, ~15 URLs)
  - /masterchef/recipes         (past-seasons index, ~136 URLs)
  - Pinterest weekly boards     (current season — superset of participants)
  - Pinterest historical boards (past-season fan-faves, season-15, season-17)
"""
from __future__ import annotations

import re
import time
from collections import Counter

from .http import get

# match recipe URLs whether absolute or relative; captures (slug-id, yy, mm, dd)
REC_RE = re.compile(
    r"(?:https?://10\.com\.au)?(/masterchef/recipes/[a-z0-9\-]+/r(\d{2})(\d{2})(\d{2})[a-z0-9]+)",
    re.I,
)
PINTEREST_BOARD_RE = re.compile(r'"url":"/masterchefau/([^"/]+)/"', re.I)


def _harvest(text: str) -> set[str]:
    return {"https://10.com.au" + m.group(1) for m in REC_RE.finditer(text)}


def from_participants() -> set[str]:
    try:
        return _harvest(get("https://10.com.au/masterchef/participants"))
    except Exception as e:
        print(f"  participants FAIL: {e}")
        return set()


def from_recipes_index() -> set[str]:
    try:
        return _harvest(get("https://10.com.au/masterchef/recipes"))
    except Exception as e:
        print(f"  recipes index FAIL: {e}")
        return set()


def from_wayback() -> set[str]:
    """Wayback Machine CDX index — historical archive, catches recipes that
    aren't linked anywhere on the live site (e.g. older bulk-imports).
    Free, no auth, occasionally flaky so retry a couple of times.
    """
    import json
    import requests
    from .http import HEADERS

    url = (
        "https://web.archive.org/cdx/search/cdx"
        "?url=10.com.au/masterchef/recipes/*"
        "&output=json&fl=original&collapse=urlkey"
    )
    found: set[str] = set()
    for attempt in range(4):
        try:
            r = requests.get(url, headers=HEADERS, timeout=180)
            if r.status_code != 200 or not r.text.strip():
                time.sleep(2 ** attempt)
                continue
            rows = r.json()
            for row in rows[1:]:
                orig = row[0]
                m = REC_RE.search(orig)
                if m:
                    found.add("https://10.com.au" + m.group(1).split("?")[0])
            print(f"  wayback: {len(rows)-1} archived URLs -> {len(found)} unique recipes")
            return found
        except Exception as e:
            print(f"  wayback attempt {attempt+1}: {e}")
            time.sleep(2 ** attempt)
    print("  wayback: gave up after retries (returning empty)")
    return found


def from_pinterest() -> set[str]:
    """Walk the masterchefau Pinterest profile, then every board it exposes."""
    found: set[str] = set()
    try:
        prof = get("https://www.pinterest.com.au/masterchefau/")
    except Exception as e:
        print(f"  pinterest profile FAIL: {e}")
        return found

    found |= _harvest(prof)
    slugs = sorted(set(PINTEREST_BOARD_RE.findall(prof)))
    print(f"  pinterest profile -> {len(slugs)} boards: {slugs}")

    for slug in slugs:
        try:
            text = get(f"https://www.pinterest.com.au/masterchefau/{slug}/")
            new = _harvest(text)
            found |= new
            print(f"    /{slug}/ -> +{len(new)} URLs (cum {len(found)})")
            time.sleep(0.6)
        except Exception as e:
            print(f"    {slug} FAIL: {e}")
    return found


def from_manual_seeds() -> set[str]:
    """Read URLs from MASTERCHEF/manual_seeds.txt (one per line, # for comments).
    Lets the user add specific recipes auto-discovery missed."""
    from pathlib import Path
    path = Path(__file__).resolve().parent.parent / "manual_seeds.txt"
    if not path.exists():
        return set()
    out = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if REC_RE.search(line):
            m = REC_RE.search(line)
            out.add("https://10.com.au" + m.group(1))
    return out


def discover_all() -> dict[str, set[str]]:
    """Run every source, return per-source sets so caller can dedupe + report."""
    print("[discover] participants ...")
    p = from_participants()
    print(f"  -> {len(p)}")

    print("[discover] /masterchef/recipes ...")
    idx = from_recipes_index()
    print(f"  -> {len(idx)}")

    print("[discover] Pinterest ...")
    pin = from_pinterest()
    print(f"  -> {len(pin)}")

    print("[discover] Wayback Machine ...")
    wb = from_wayback()
    print(f"  -> {len(wb)}")

    print("[discover] manual_seeds.txt ...")
    ms = from_manual_seeds()
    print(f"  -> {len(ms)}")

    return {"participants": p, "recipes_index": idx, "pinterest": pin, "wayback": wb, "manual": ms}


def summarize(per_source: dict[str, set[str]]) -> None:
    union = set().union(*per_source.values())
    years = Counter()
    for u in union:
        m = REC_RE.search(u)
        if m:
            years[m.group(2)] += 1
    print("\n[discover] SUMMARY")
    for k, s in per_source.items():
        print(f"  {k:18s} {len(s):4d} URLs")
    print(f"  {'UNION':18s} {len(union):4d} URLs")
    print(f"  by URL year prefix: {sorted(years.items())}")


if __name__ == "__main__":
    res = discover_all()
    summarize(res)
