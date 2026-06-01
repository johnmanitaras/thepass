"""Static SEO surface for The Pass.

Generates one crawlable HTML page per recipe (real <title>/description/canonical,
Open Graph, and Recipe JSON-LD), a correct sitemap.xml, robots.txt, and the GA loader.

Honours the project's legal stance: pages carry factual metadata + ingredients and
link out to 10 Play for the method. recipeInstructions are deliberately NOT emitted.
"""
from __future__ import annotations

import html
import json
from pathlib import Path

from . import parse

# --- one-place config -------------------------------------------------------
# No trailing slash. Change this when a custom domain goes live, then rebuild.
SITE_URL = "https://johnmanitaras.github.io/thepass"
# GA4 Measurement ID. Placeholder == analytics off.
GA_ID = "G-30P2Q7BSER"


def _description(r: dict) -> str:
    parts = [r.get("title") or "Recipe"]
    tail = []
    if r.get("chef"):
        tail.append("by " + r["chef"])
    if r.get("season"):
        tail.append(f"MasterChef Australia Season {r['season']}")
    if tail:
        parts.append("— " + ", ".join(tail))
    text = " ".join(parts)
    ings = [it["name"] for g in r.get("ingredientGroups") or [] for it in g.get("items") or []]
    if ings:
        text += ". Ingredients: " + ", ".join(ings[:8]) + ("…" if len(ings) > 8 else "")
    text += ". Full method on 10 Play."
    return text[:300]


def _jsonld(r: dict) -> str:
    data = {
        "@context": "https://schema.org",
        "@type": "Recipe",
        "name": r.get("title"),
        "url": f"{SITE_URL}/r/{r['id']}.html",
        "sameAs": r.get("url"),
        "isBasedOn": r.get("url"),
        "publisher": {"@type": "Organization", "name": "Network 10", "url": "https://10.com.au"},
    }
    if r.get("image"):
        data["image"] = r["image"]
    if r.get("chef"):
        data["author"] = {"@type": "Person", "name": r["chef"]}
    if r.get("published"):
        data["datePublished"] = r["published"]
    if r.get("serves"):
        data["recipeYield"] = str(r["serves"])
    if r.get("course"):
        data["recipeCategory"] = r["course"]
    if r.get("tags"):
        data["keywords"] = ", ".join(r["tags"])
    ings = []
    for g in r.get("ingredientGroups") or []:
        for it in g.get("items") or []:
            amt = (it.get("amount") or "").strip()
            ings.append((amt + " " + it["name"]).strip())
    if ings:
        data["recipeIngredient"] = ings
    # recipeInstructions intentionally omitted (copyright — see legal constraint).
    return json.dumps(data, ensure_ascii=False)


_PAGE = """<!doctype html>
<html lang="en" data-theme="pass" data-font="grotesk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE_TAG__</title>
<meta name="description" content="__DESC__">
<link rel="canonical" href="__CANON__">
<meta name="robots" content="index,follow">
<meta property="og:type" content="article">
<meta property="og:site_name" content="The Pass">
<meta property="og:title" content="__OG_TITLE__">
<meta property="og:description" content="__DESC__">
<meta property="og:url" content="__CANON__">
__OG_IMAGE__
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="__OG_TITLE__">
<meta name="twitter:description" content="__DESC__">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Spectral:wght@400;500;600&family=Space+Grotesk:wght@400;500;600;700&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../styles.css">
<script type="application/ld+json">__JSONLD__</script>
<script src="../analytics.js"></script>
</head>
<body>
<div class="topbar"><div class="wrap topbar-inner">
<a class="brand" href="../"><span class="dot"></span>The Pass <small>MasterChef AU</small></a>
</div></div>
<main class="reader"><div class="wrap">
<a class="backlink" href="../">&larr; All recipes</a>
<section class="hero">
<div>
<div class="label kicker">__KICKER__</div>
<h1>__TITLE__</h1>
__CHEFCHIP__
<div style="margin-top:26px;display:flex;gap:10px;flex-wrap:wrap">
<a class="btn" href="__URL__" target="_blank" rel="noopener">View full method on 10 Play &#8599;</a>
<a class="btn ghost" href="../#/r/__ID__">Open in The Pass</a>
</div>
</div>
<div class="hero-photo">__HERO_IMG__</div>
</section>
<section class="specstrip">__SPEC__</section>
<div style="max-width:780px">
<div class="sectionhead">Ingredients</div>
__INGREDIENTS__
<div class="methodcard" style="margin-top:36px">
<div class="label">Method</div>
<h2>Cook it from the source.</h2>
<p>We index the ingredients and details; the step-by-step method lives on Network 10's original recipe page.</p>
<a class="btn" href="__URL__" target="_blank" rel="noopener">Open the full method on 10 Play &#8599;</a>
</div>
__TAGS__
<div class="source"><div class="txt">Recipe by <b>__CHEF_NAME__</b>__SEASON_TXT__. Originally published by <b>Network 10</b>__PUB_TXT__.</div>
<a class="btn ghost" href="__URL__" target="_blank" rel="noopener">Original on 10 Play &#8599;</a></div>
</div>
</div></main>
<footer class="wrap" style="padding:40px 0 60px;color:var(--ink-faint);font-size:.85rem;border-top:1px solid var(--line)">
<p>The Pass is an independent index of publicly published MasterChef Australia recipe pages. Recipes, photos and methods are &copy; Network 10; every recipe links back to its original page on 10 Play.</p>
</footer>
</body>
</html>
"""


def render_page(r: dict) -> str:
    e = html.escape
    rid = r["id"]
    title = r.get("title") or "Recipe"
    chef = r.get("chef")
    season = r.get("season")
    course = r.get("course") or "Recipe"
    img = r.get("image")
    canon = f"{SITE_URL}/r/{rid}.html"

    title_tag = title
    if chef:
        title_tag += f" — {chef}"
    if season:
        title_tag += f", MasterChef Australia S{season}"
    title_tag += " | The Pass"

    kicker = course + (f" · Season {season}" if season else " · Earlier")

    # chef chip
    thumb = r.get("chefThumb")
    role = r.get("chefRole") or ""
    pub = r.get("published") or ""
    if thumb:
        avt = f'<img src="{e(thumb)}" alt="{e(chef or "")}">'
    else:
        initials = "".join(w[0] for w in (chef or "MC").split()[:2]).upper() or "MC"
        avt = f'<span class="avt">{e(initials)}</span>'
    rl = " · ".join([x for x in (role, pub) if x]) or "Recipe"
    chefchip = (f'<div class="chefchip">{avt}<div>'
                f'<div class="nm">{e(chef or "MasterChef Australia")}</div>'
                f'<div class="rl">{e(rl)}</div></div></div>')

    hero_img = (f'<img src="{e(img)}" alt="{e(title)}" loading="lazy">' if img
                else '<div class="ph"><span>No photo</span></div>')
    og_image = f'<meta property="og:image" content="{e(img)}">' if img else ""

    # spec strip
    groups = r.get("ingredientGroups") or []
    n_groups = len(groups)
    n_ing = sum(len(g.get("items") or []) for g in groups)
    spec_items = []
    if r.get("serves"):
        spec_items.append((e(str(r["serves"])), "Serves"))
    spec_items.append((str(n_groups), "Component" + ("" if n_groups == 1 else "s")))
    spec_items.append((str(n_ing), "Ingredients"))
    spec_items.append((str(season) if season else "—", "Season"))
    spec = "".join(f'<div class="item"><div class="v">{v}</div><div class="k">{k}</div></div>'
                   for v, k in spec_items)

    # ingredients
    blocks = []
    for g in groups:
        rows = []
        for it in g.get("items") or []:
            amt = it.get("amount") or ""
            amt_html = f'<span class="amt">{e(amt)}</span>' if amt else ""
            rows.append(f'<div class="ig static">{amt_html}<span class="nm">{e(it["name"])}</span></div>')
        gt = e(g.get("title") or "")
        gt_html = f'<div class="gt">{gt}</div>' if gt else ""
        blocks.append(f'<div class="iggroup">{gt_html}{"".join(rows)}</div>')
    ingredients = "\n".join(blocks)

    # tags (keyword chips — display/SEO only, not links)
    tags_html = ""
    if r.get("tags"):
        chips = "".join(f'<span class="tag">{e(t)}</span>' for t in r["tags"])
        tags_html = f'<div class="sectionhead">Tagged</div><div class="tags">{chips}</div>'

    season_txt = f", Season {season}" if season else ""
    pub_txt = f" on {e(pub)}" if pub else ""

    out = _PAGE
    repl = {
        "__TITLE_TAG__": e(title_tag),
        "__DESC__": e(_description(r)),
        "__CANON__": canon,
        "__OG_TITLE__": e(title),
        "__OG_IMAGE__": og_image,
        "__JSONLD__": _jsonld(r),
        "__KICKER__": e(kicker),
        "__TITLE__": e(title),
        "__CHEFCHIP__": chefchip,
        "__URL__": e(r.get("url") or ""),
        "__ID__": e(rid),
        "__HERO_IMG__": hero_img,
        "__SPEC__": spec,
        "__INGREDIENTS__": ingredients,
        "__TAGS__": tags_html,
        "__CHEF_NAME__": e(chef or "a MasterChef Australia contestant"),
        "__SEASON_TXT__": e(season_txt),
        "__PUB_TXT__": pub_txt,
    }
    for k, v in repl.items():
        out = out.replace(k, v)
    return out


def _analytics_js() -> str:
    return (
        "// Auto-generated by masterchef.build. Set GA_ID in masterchef/seo.py.\n"
        "(function(){\n"
        f'  var ID = "{GA_ID}";\n'
        '  if (!ID || ID.indexOf("XXXX") >= 0) return;   // no-op until a real GA4 ID is set\n'
        "  var s = document.createElement('script'); s.async = true;\n"
        '  s.src = "https://www.googletagmanager.com/gtag/js?id=" + ID;\n'
        "  document.head.appendChild(s);\n"
        "  window.dataLayer = window.dataLayer || [];\n"
        "  window.gtag = function(){ dataLayer.push(arguments); };\n"
        "  gtag('js', new Date());\n"
        "  gtag('config', ID);\n"
        "})();\n"
    )


def _sitemap(records: list[dict]) -> str:
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
             f"  <url><loc>{SITE_URL}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>"]
    for r in records:
        loc = f"{SITE_URL}/r/{r['id']}.html"
        lastmod = parse.air_date_from_id(r.get("url") or "")
        lm = f"<lastmod>{lastmod}</lastmod>" if lastmod else ""
        lines.append(f"  <url><loc>{loc}</loc>{lm}<changefreq>monthly</changefreq><priority>0.7</priority></url>")
    lines.append("</urlset>\n")
    return "\n".join(lines)


def _robots() -> str:
    return f"User-agent: *\nAllow: /\n\nSitemap: {SITE_URL}/sitemap.xml\n"


def write_seo(records: list[dict], web_dir: Path) -> int:
    """Write per-recipe pages, sitemap.xml, robots.txt, analytics.js. Returns page count."""
    rdir = web_dir / "r"
    rdir.mkdir(parents=True, exist_ok=True)
    # prune stale pages (recipes that disappeared)
    keep = {r["id"] + ".html" for r in records}
    for f in rdir.glob("*.html"):
        if f.name not in keep:
            f.unlink()
    for r in records:
        (rdir / f"{r['id']}.html").write_text(render_page(r), encoding="utf-8")
    (web_dir / "sitemap.xml").write_text(_sitemap(records), encoding="utf-8")
    (web_dir / "robots.txt").write_text(_robots(), encoding="utf-8")
    (web_dir / "analytics.js").write_text(_analytics_js(), encoding="utf-8")
    return len(records)
