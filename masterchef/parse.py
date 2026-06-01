"""Fetch a recipe page and extract structured metadata via schema.org JSON-LD."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, asdict, field
from typing import Any

from bs4 import BeautifulSoup

from .http import get

ID_RE = re.compile(r"/r(\d{2})(\d{2})(\d{2})([a-z0-9]+)$")
SEASON_RE = re.compile(r"season\s+(\d{1,2})", re.I)
BY_RE = re.compile(r"Try\s+([A-Z][\w'’\-]+(?:\s+[A-Z][\w'’\-]+){0,3})['’]s")

# The recipe page embeds a rich JSON blob `const showRecipePageData = {...};`
# It is strictly richer than the schema.org JSON-LD: grouped ingredients (with
# amount/name split), the chef's thumbnail + role + season link, formatted
# publish date, and tags. We prefer it for the public dataset.
SHOW_BLOB_RE = re.compile(r"const showRecipePageData = (\{[\s\S]*?\});</script>")
CHEF_SEASON_RE = re.compile(r"/season-(\d+)/", re.I)

# Course derivation (see SPEC §3.1). Coarse heuristic over title + tags.
_DESSERT_KW = re.compile(
    r"\b(cake|ice ?cream|mousse|tart|sorbet|parfait|br[uû]l[eé]e|pudding|cheesecake|"
    r"macaron|meringue|chocolate|caramel|custard|panna ?cotta|gelato|truffle|"
    r"doughnut|donut|brownie|pavlova)\b",
    re.I,
)
_ENTREE_KW = re.compile(r"\b(soup|broth)\b", re.I)
_DRINK_KW = re.compile(r"\b(cocktail|spritz|martini)\b", re.I)

# Map URL-year prefix -> show season number. From public records:
#   2009=S1, 2010=S2, ..., 2019=S11, 2020=S12, 2021=S13, 2022=S14, 2023=S15,
#   2024=S16, 2025=S17, 2026=S18.
URL_YEAR_TO_SEASON = {
    "09": 1,  "10": 2,  "11": 3,  "12": 4,  "13": 5,  "14": 6,  "15": 7,
    "16": 8,  "17": 9,  "18": 10, "19": 11, "20": 12, "21": 13, "22": 14,
    "23": 15, "24": 16, "25": 17, "26": 18,
}


@dataclass
class Recipe:
    url: str
    recipe_id: str = ""
    air_date: str | None = None
    season: int | None = None
    title: str | None = None
    contestant: str | None = None
    servings: str | None = None
    prep_time: str | None = None
    cook_time: str | None = None
    description: str | None = None
    image: str | None = None
    keywords: list[str] = field(default_factory=list)
    ingredients: list[str] = field(default_factory=list)
    instructions: list[str] = field(default_factory=list)
    publisher: str | None = None
    parse_warnings: list[str] = field(default_factory=list)


# 2019-06-14 was the bulk-import date when 10 migrated to the new CMS.
# All ~88 URLs sharing that exact date contain content from arbitrary pre-S11
# seasons (e.g. r190614oebqd is Mimi Baines, S5). The URL date is the import
# day, not the air date. Tag these as ambiguous so the frontend can group them.
BULK_IMPORT_DATES = {"2019-06-14"}


def parse_id(url: str) -> tuple[str, str | None, int | None]:
    m = ID_RE.search(url)
    if not m:
        return ("", None, None)
    yy, mm, dd, _ = m.groups()
    air = f"20{yy}-{mm}-{dd}"
    if air in BULK_IMPORT_DATES:
        return (m.group(0).lstrip("/"), None, None)  # season unknown
    season = URL_YEAR_TO_SEASON.get(yy)
    return (m.group(0).lstrip("/"), air, season)


def _find_recipe_jsonld(soup: BeautifulSoup) -> dict[str, Any] | None:
    for s in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(s.string or "")
        except Exception:
            continue
        graph = data.get("@graph") if isinstance(data, dict) else None
        candidates = graph or ([data] if isinstance(data, dict) else data or [])
        for item in candidates:
            if isinstance(item, dict) and item.get("@type") == "Recipe":
                return item
    return None


def _html_steps_to_list(html: str | None) -> list[str]:
    if not html:
        return []
    soup = BeautifulSoup(html, "lxml")
    return [li.get_text(" ", strip=True) for li in soup.find_all("li") if li.get_text(strip=True)]


def parse(url: str, html: str) -> Recipe:
    rid, air, season = parse_id(url)
    rec = Recipe(url=url, recipe_id=rid, air_date=air, season=season)
    soup = BeautifulSoup(html, "lxml")
    r = _find_recipe_jsonld(soup)
    if not r:
        rec.parse_warnings.append("no Recipe JSON-LD")
        return rec

    rec.title = r.get("name")
    rec.description = r.get("description")
    rec.servings = str(r.get("recipeServe")) if r.get("recipeServe") else None
    rec.prep_time = r.get("prepTime")
    rec.cook_time = r.get("cookTime")

    img = r.get("image")
    if isinstance(img, dict):
        rec.image = img.get("url")
    elif isinstance(img, list) and img:
        rec.image = img[0].get("url") if isinstance(img[0], dict) else img[0]
    elif isinstance(img, str):
        rec.image = img

    author = r.get("author")
    if isinstance(author, dict):
        rec.contestant = author.get("name")
    elif isinstance(author, list) and author:
        rec.contestant = author[0].get("name") if isinstance(author[0], dict) else author[0]
    if not rec.contestant and rec.description:
        m = BY_RE.search(rec.description)
        if m:
            rec.contestant = m.group(1).strip()

    # Prefer URL-year-derived season; fall back to description regex
    if not rec.season and rec.description:
        sm = SEASON_RE.search(rec.description)
        if sm:
            try:
                rec.season = int(sm.group(1))
            except ValueError:
                pass

    kws = r.get("keywords")
    if isinstance(kws, str):
        rec.keywords = [k.strip() for k in kws.split(",") if k.strip()]
    elif isinstance(kws, list):
        rec.keywords = [str(k) for k in kws]

    ing = r.get("recipeIngredient")
    if isinstance(ing, list):
        rec.ingredients = [str(x).strip() for x in ing]

    instr = r.get("recipeInstructions")
    if isinstance(instr, str):
        rec.instructions = _html_steps_to_list(instr)
    elif isinstance(instr, list):
        steps = []
        for x in instr:
            if isinstance(x, dict):
                steps.append(x.get("text") or x.get("name") or "")
            else:
                steps.append(str(x))
        rec.instructions = [s for s in steps if s]

    pub = r.get("publisher")
    if isinstance(pub, dict):
        rec.publisher = pub.get("name")

    return rec


def fetch_and_parse(url: str) -> Recipe:
    html = get(url)
    return parse(url, html)


def to_public(rec: Recipe) -> dict:
    """Trimmed dict for the public frontend — title, image, ingredients, keywords, link out.
    Method is intentionally OMITTED to avoid republishing the copyrighted prose.
    """
    return {
        "url": rec.url,
        "id": rec.recipe_id,
        "title": rec.title,
        "contestant": rec.contestant,
        "season": rec.season,
        "air_date": rec.air_date,
        "image": rec.image,
        "keywords": rec.keywords,
        "ingredients": rec.ingredients,  # ingredients ARE factual, not copyrightable
        "servings": rec.servings,
        "description": rec.description,
    }


# ---------------------------------------------------------------------------
# Spec-schema parser (showRecipePageData) — produces the record the frontend
# consumes. Method/steps are intentionally NOT extracted: the public site links
# back to 10 Play for the copyrighted method prose (factual ingredients are kept).
# ---------------------------------------------------------------------------

def _derive_course(title: str | None, tags: list[str]) -> str:
    t = title or ""
    tagset = {x.lower() for x in tags}
    if "dessert" in tagset or _DESSERT_KW.search(t):
        return "Dessert"
    if _ENTREE_KW.search(t):
        return "Entrée"
    if _DRINK_KW.search(t):
        return "Drink"
    return "Main"


def _clean_serves(s) -> str | None:
    if s is None:
        return None
    s = re.sub(r"^\s*serves\s*", "", str(s).strip(), flags=re.I).strip()
    return s or None


def _resolve_season(yy: str | None, chef_link: str | None) -> int | None:
    """yy >= 20 → real publish date, trust the URL-year→season map (the recipe's
    own season). yy == 19 / older → CMS bulk-import era where the URL date is the
    migration day, so trust the chef's season link instead. None if neither works."""
    chef_season = None
    if chef_link:
        m = CHEF_SEASON_RE.search(chef_link)
        if m:
            chef_season = int(m.group(1))
    if yy and yy.isdigit() and int(yy) >= 20:
        return URL_YEAR_TO_SEASON.get(yy) or chef_season
    return chef_season


def parse_show_data(url: str, html: str) -> dict | None:
    """Parse the embedded showRecipePageData blob into the frontend's flat schema.
    Returns None if the blob is absent (e.g. a 404 / non-recipe page)."""
    m = SHOW_BLOB_RE.search(html)
    if not m:
        return None
    try:
        data = json.loads(m.group(1))
    except Exception:
        return None

    idm = ID_RE.search(url)
    rid = idm.group(0).lstrip("/") if idm else ""
    yy = idm.group(1) if idm else None

    c = data.get("content") or {}
    chef = c.get("chef") or {}

    groups: list[dict] = []
    for g in c.get("ingredientList") or []:
        items = []
        for it in g.get("ingredients") or []:
            name = (it.get("ingredient") or "").strip()
            if not name:
                continue
            items.append({"amount": (it.get("amount") or "").strip(), "name": name})
        title = (g.get("title") or "").strip()
        if items or title:
            groups.append({"title": title, "items": items})

    tags = [t.get("name").strip() for t in (c.get("tags") or []) if t.get("name")]
    title = c.get("headline") or None

    return {
        "id": rid,
        "title": title,
        "image": (c.get("image") or None),
        "chef": (chef.get("name") or None),
        "chefRole": (chef.get("role") or None),
        "chefThumb": (chef.get("thumbnail") or None),
        "season": _resolve_season(yy, chef.get("link")),
        "serves": _clean_serves(c.get("serves")),
        "published": (c.get("publishedDate") or None),
        "url": (data.get("canonicalUrl") or url),
        "course": _derive_course(title, tags),
        "tags": tags,
        "ingredientGroups": groups,
    }


def air_date_from_id(url: str) -> str | None:
    """Best-effort ISO date from the URL id (publish/import day) — used for the sitemap."""
    m = ID_RE.search(url)
    if not m:
        return None
    yy, mm, dd, _ = m.groups()
    return f"20{yy}-{mm}-{dd}"
