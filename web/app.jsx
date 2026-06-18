/* =========================================================================
   The Pass — buildless React app (React 18 UMD + in-browser Babel).
   Single file: utils, Browse, Reader, App shell, routing, theming.
   Method/steps are NOT rendered — the Reader links out to 10 Play for the
   copyrighted method. Ingredients (factual) + metadata are shown in full.
   ========================================================================= */
const { useState, useEffect, useMemo, useRef, useCallback } = React;

const RECIPES = (window.RECIPES || []).map(r => ({ ...r }));

/* ---- persistence --------------------------------------------------------- */
function usePersist(key, init) {
  const [v, setV] = useState(() => {
    try { const s = localStorage.getItem(key); return s != null ? JSON.parse(s) : init; }
    catch (e) { return init; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }, [key, v]);
  return [v, setV];
}

/* ---- text / search ------------------------------------------------------- */
// AU/US spelling aliases so either spelling matches both (extend as needed).
const aliases = s => s
  .replace(/whiske?y/g, "whisky")     // whiskey / whisky
  .replace(/yogh?urt/g, "yoghurt")    // yogurt / yoghurt
  .replace(/colou?r/g, "color");      // colour / color
const norm = s => aliases((s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());

function haystack(r) {
  const ings = (r.ingredientGroups || []).map(g =>
    (g.items || []).map(it => it.name).join(" ") + " " + (g.title || "")).join(" ");
  return norm([
    r.title, r.chef, r.course,
    r.season != null ? "season " + r.season : "earlier",
    (r.tags || []).join(" "), ings,
  ].join(" "));
}
function matchesQuery(r, q) {
  if (!q) return true;
  if (!r._hay) r._hay = haystack(r);
  return norm(q).split(/\s+/).filter(Boolean).every(t => r._hay.includes(t));
}

/* ---- serving-size scaler (SPEC §6.1) ------------------------------------- */
const UNI = { "¼":.25,"½":.5,"¾":.75,"⅓":1/3,"⅔":2/3,"⅛":.125,"⅜":.375,"⅝":.625,"⅞":.875,
  "⅕":.2,"⅖":.4,"⅗":.6,"⅘":.8,"⅙":1/6,"⅚":5/6,"⅐":1/7,"⅑":1/9,"⅒":.1 };
const NICE = [[0,""],[.125,"⅛"],[.25,"¼"],[1/3,"⅓"],[.375,"⅜"],[.5,"½"],[.625,"⅝"],[2/3,"⅔"],[.75,"¾"],[.875,"⅞"],[1,""]];

function fmtNum(x) {
  if (!isFinite(x) || x < 0) return "";
  if (x === 0) return "0";
  if (x >= 10) return String(Math.round(x));
  const whole = Math.floor(x + 1e-9);
  const frac = x - whole;
  let best = 0, glyph = "", bd = Infinity;
  for (const [val, g] of NICE) { const d = Math.abs(frac - val); if (d < bd) { bd = d; best = val; glyph = g; } }
  let w = whole;
  if (best === 1) { w += 1; glyph = ""; }
  if (w === 0 && glyph === "") return String(Math.round(x * 100) / 100);
  if (glyph === "") return String(w);
  return (w > 0 ? w : "") + glyph;
}

const isSpace = c => c === " " || c === " ";

// read one numeric value at index i; returns {val, end} or null
function readValue(s, i) {
  const start = i;
  let intPart = "";
  while (i < s.length && /[0-9]/.test(s[i])) { intPart += s[i]; i++; }
  if (s[i] === "." && /[0-9]/.test(s[i + 1] || "")) {
    let dec = "."; i++;
    while (i < s.length && /[0-9]/.test(s[i])) { dec += s[i]; i++; }
    return { val: parseFloat(intPart + dec), end: i };
  }
  let j = i; while (j < s.length && isSpace(s[j])) j++;
  const fm = s.slice(j).match(/^([0-9]+)\/([0-9]+)/);
  if (fm) {
    const whole = intPart ? +intPart : 0;
    return { val: whole + (+fm[1]) / (+fm[2]), end: j + fm[0].length };
  }
  if (i < s.length && UNI[s[i]] != null) return { val: (intPart ? +intPart : 0) + UNI[s[i]], end: i + 1 };
  if (intPart && j < s.length && UNI[s[j]] != null) return { val: (+intPart) + UNI[s[j]], end: j + 1 };
  if (intPart) return { val: +intPart, end: i };
  if (UNI[s[start]] != null) return { val: UNI[s[start]], end: start + 1 };
  return null;
}

function scaleAmount(amount, factor) {
  if (!amount || factor === 1) return { text: amount || "", changed: false };
  const s = amount;
  let i = 0; while (i < s.length && isSpace(s[i])) i++;
  const v1 = readValue(s, i);
  if (!v1) return { text: amount, changed: false };
  let end = v1.end; const nums = [v1.val];
  let k = end; while (k < s.length && isSpace(s[k])) k++;
  if (s[k] === "-" || s[k] === "–" || s[k] === "—") {
    let m = k + 1; while (m < s.length && isSpace(s[m])) m++;
    const v2 = readValue(s, m);
    if (v2) { nums.push(v2.val); end = v2.end; }
  }
  const suffix = s.slice(end);
  const text = s.slice(0, i) + nums.map(n => fmtNum(n * factor)).join("–") + suffix;
  return { text, changed: true };
}

/* ---- icons --------------------------------------------------------------- */
const I = {
  search: p => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>,
  x: p => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><path d="M18 6L6 18M6 6l12 12"/></svg>,
  heart: p => <svg viewBox="0 0 24 24" {...p}><path d="M12 21s-7.5-4.8-10-9.2C.3 8.6 1.6 5 5 5c2 0 3.2 1.2 4 2.3C9.8 6.2 11 5 13 5c3.4 0 4.7 3.6 3 6.8C19.5 16.2 12 21 12 21z" fill={p && p.fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7"/></svg>,
  back: p => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M15 18l-6-6 6-6"/></svg>,
  ext: p => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 4h6v6M20 4l-9 9M19 13v6a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h6"/></svg>,
  check: p => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 12l5 5L20 6"/></svg>,
  image: p => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.6"/><path d="M21 16l-5-5L5 21"/></svg>,
  sliders: p => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="13" cy="18" r="2"/></svg>,
};

/* ---- image with graceful placeholder ------------------------------------- */
function Img({ src, alt }) {
  const [err, setErr] = useState(false);
  if (!src || err) return (
    <div className="ph"><I.image /><span>No photo</span></div>
  );
  return <img src={src} alt={alt || ""} loading="lazy" onError={() => setErr(true)} />;
}

/* ---- routing helpers ----------------------------------------------------- */
function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash || "#/");
  useEffect(() => {
    const on = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}
const go = h => { window.location.hash = h; };
let browseScroll = 0;

/* =========================================================================
   Card
   ========================================================================= */
function Card({ r, feat, saved, onSave }) {
  return (
    <article className={"card" + (feat ? " feat-" + feat : "")}
      onClick={() => { browseScroll = window.scrollY; go("#/r/" + r.id); }}>
      <div className="card-media">
        <span className="badge">{r.course}</span>
        <button className={"save" + (saved ? " on" : "")} title={saved ? "Saved" : "Save"}
          onClick={e => { e.stopPropagation(); onSave(r.id); }}>
          <I.heart fill={saved ? 1 : 0} />
        </button>
        <Img src={r.image} alt={r.title} />
      </div>
      <div className="card-body">
        <h3>{r.title}</h3>
        <div className="meta">
          {r.chef ? <b>{r.chef}</b> : <b>MasterChef AU</b>}
          {r.season != null ? <> · Season {r.season}</> : <> · Earlier</>}
        </div>
      </div>
    </article>
  );
}

/* =========================================================================
   Browse
   ========================================================================= */
const COURSE_ORDER = ["Main", "Entrée", "Dessert", "Drink"];

// Parse a "DD Mon YYYY" published date into a sortable UTC timestamp.
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function pubTime(r) {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec(r.published || "");
  const mon = m && MONTHS[m[2].toLowerCase()];
  return m && mon != null ? Date.UTC(+m[3], mon, +m[1]) : -Infinity;
}

function Browse({ saved, onSave }) {
  const [q, setQ] = usePersist("mc_q", "");
  const [course, setCourse] = usePersist("mc_course", "");
  const [season, setSeason] = usePersist("mc_season", "");   // "" = all, number, or "earlier"
  const [sort, setSort] = usePersist("mc_sort", "newest");
  const [savedOnly, setSavedOnly] = useState(false);
  const [qLive, setQLive] = useState(q);

  // debounce search input -> q
  useEffect(() => { const t = setTimeout(() => setQ(qLive), 170); return () => clearTimeout(t); }, [qLive]);

  const savedSet = useMemo(() => new Set(saved), [saved]);

  const courses = useMemo(() => {
    const c = {};
    RECIPES.forEach(r => { c[r.course] = (c[r.course] || 0) + 1; });
    return COURSE_ORDER.filter(x => c[x]).map(x => [x, c[x]]);
  }, []);
  const seasons = useMemo(() => {
    const c = {}; let earlier = 0;
    RECIPES.forEach(r => { if (r.season == null) earlier++; else c[r.season] = (c[r.season] || 0) + 1; });
    const arr = Object.keys(c).map(Number).sort((a, b) => b - a).map(s => [s, c[s]]);
    return { arr, earlier };
  }, []);

  const filtered = useMemo(() => {
    let out = RECIPES.filter(r => {
      if (course && r.course !== course) return false;
      if (season === "earlier") { if (r.season != null) return false; }
      else if (season !== "" && r.season !== Number(season)) return false;
      if (savedOnly && !savedSet.has(r.id)) return false;
      return matchesQuery(r, q);
    });
    const byTitle = (a, b) => (a.title || "").localeCompare(b.title || "");
    const sNum = r => (r.season == null ? -1 : r.season);
    out = out.slice();
    if (sort === "newest") out.sort((a, b) => pubTime(b) - pubTime(a) || sNum(b) - sNum(a) || byTitle(a, b));
    else if (sort === "oldest") out.sort((a, b) => { const x = sNum(a), y = sNum(b); if (x < 0) return 1; if (y < 0) return -1; return x - y || byTitle(a, b); });
    else if (sort === "az") out.sort(byTitle);
    else if (sort === "chef") out.sort((a, b) => (a.chef || "~").localeCompare(b.chef || "~") || sNum(b) - sNum(a));
    return out;
  }, [q, course, season, sort, savedOnly, savedSet]);

  const [layout, setLayout] = useState(() => document.documentElement.getAttribute("data-layout") || "mosaic");
  useEffect(() => {
    const on = () => setLayout(document.documentElement.getAttribute("data-layout") || "mosaic");
    window.addEventListener("layoutchange", on);
    return () => window.removeEventListener("layoutchange", on);
  }, []);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeCount = (course ? 1 : 0) + (season !== "" ? 1 : 0) + (savedOnly ? 1 : 0);
  const active = q || course || season !== "" || savedOnly;
  const clearAll = () => { setQLive(""); setQ(""); setCourse(""); setSeason(""); setSavedOnly(false); };

  const featFor = i => {
    if (layout !== "mosaic") return null;
    if (i % 21 === 0) return 8;
    if (i % 21 === 11) return 6;
    return null;
  };

  return (
    <main>
      <div className="wrap">
        <header className="masthead">
          <div className="label kicker">The unlisted MasterChef Australia archive</div>
          <h1>Every recipe they quietly stopped linking to.</h1>
          <p className="lead">A fast, cook-focused index of MasterChef Australia recipes — including the
            current season pages that never make it onto the official menu. Browse, search, scale, and
            cook. The full method always links back to 10 Play.</p>
          <div className="stats">
            <div className="stat"><div className="n">{RECIPES.length}</div><div className="l">recipes</div></div>
            <div className="stat"><div className="n">{seasons.arr.length}</div><div className="l">seasons</div></div>
            <div className="stat"><div className="n">{new Set(RECIPES.map(r => r.chef).filter(Boolean)).size}</div><div className="l">cooks</div></div>
          </div>
        </header>
      </div>

      <div className="controls">
        <div className="wrap">
          <div className={"searchbar" + (qLive ? " has-q" : "")}>
            <I.search className="s" />
            <input value={qLive} onChange={e => setQLive(e.target.value)} autoComplete="off"
              placeholder="Search recipes, cooks, ingredients, tags…" aria-label="Search recipes" />
            <button className="clear" onClick={() => { setQLive(""); setQ(""); }} aria-label="Clear search"><I.x /></button>
          </div>

          <button className={"filtertoggle" + (filtersOpen ? " open" : "")}
            onClick={() => setFiltersOpen(o => !o)} aria-expanded={filtersOpen}>
            <span className="ft-l"><I.sliders /> Filters{activeCount > 0 && <span className="fcount">{activeCount}</span>}</span>
            <span className="ft-r">{filtersOpen ? "Done" : "Show"}</span>
          </button>

          <div className={"filterpanel" + (filtersOpen ? " open" : "")}>
            <div className="filters">
              <div className="filtergroup">
                <span className="gl label">Course</span>
                <button className={"chip" + (course === "" ? " on" : "")} onClick={() => setCourse("")}>All</button>
                {courses.map(([c, n]) =>
                  <button key={c} className={"chip" + (course === c ? " on" : "")} onClick={() => setCourse(course === c ? "" : c)}>
                    {c} <span className="cnt">{n}</span></button>)}
              </div>

              <div className="spacer" />

              <button className={"chip" + (savedOnly ? " on" : "")} onClick={() => setSavedOnly(v => !v)}>
                <I.heart fill={savedOnly ? 1 : 0} style={{ width: 15, height: 15 }} /> Saved <span className="cnt">{saved.length}</span>
              </button>
              <select className="sort" value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort">
                <option value="newest">Most recent</option>
                <option value="oldest">Earliest seasons</option>
                <option value="az">A–Z</option>
                <option value="chef">By cook</option>
              </select>
              {active && <button className="clearfilters" onClick={clearAll}>Clear filters</button>}
            </div>

            <div className="filters" style={{ marginTop: 10 }}>
              <div className="filtergroup">
                <span className="gl label">Season</span>
                <button className={"chip" + (season === "" ? " on" : "")} onClick={() => setSeason("")}>All seasons</button>
                {seasons.arr.map(([s, n]) =>
                  <button key={s} className={"chip" + (season === s ? " on" : "")} onClick={() => setSeason(season === s ? "" : s)}>
                    S{s} <span className="cnt">{n}</span></button>)}
                {seasons.earlier > 0 &&
                  <button className={"chip" + (season === "earlier" ? " on" : "")} onClick={() => setSeason(season === "earlier" ? "" : "earlier")}>
                    Earlier <span className="cnt">{seasons.earlier}</span></button>}
              </div>
            </div>

            <button className="panel-done btn" onClick={() => setFiltersOpen(false)}>
              Show {filtered.length} {filtered.length === 1 ? "recipe" : "recipes"}
            </button>
          </div>
        </div>
      </div>

      <div className="wrap">
        <div className="resultsmeta">{filtered.length} {filtered.length === 1 ? "recipe" : "recipes"}{active ? " match your filters" : ""}</div>
        {filtered.length === 0 ? (
          <div className="empty">
            <h3>Nothing on the pass.</h3>
            <p>No recipes match your search and filters.</p>
            <button className="btn ghost" onClick={clearAll}>Clear filters</button>
          </div>
        ) : (
          <div className={layout === "mosaic" ? "mosaic" : "grid-uniform"}>
            {filtered.map((r, i) =>
              <Card key={r.id} r={r} feat={featFor(i)} saved={savedSet.has(r.id)} onSave={onSave} />)}
          </div>
        )}
      </div>
    </main>
  );
}

/* =========================================================================
   Reader
   ========================================================================= */
function IngredientGroup({ g, gi, factor, checks, toggle }) {
  return (
    <div className="iggroup">
      {g.title && <div className="gt">{g.title}</div>}
      {g.items.map((it, ii) => {
        const key = gi + ":" + ii;
        const on = !!checks[key];
        const sc = scaleAmount(it.amount, factor);
        return (
          <div key={key} className={"ig" + (on ? " checked" : "")} onClick={() => toggle(key)}>
            <span className="box"><I.check /></span>
            {sc.text && <span className={"amt" + (sc.changed ? " scaled" : "")}>{sc.text}</span>}
            <span className="nm">{it.name}</span>
          </div>
        );
      })}
    </div>
  );
}

function Reader({ id, saved, onSave }) {
  const r = useMemo(() => RECIPES.find(x => x.id === id), [id]);
  const [checks, setChecks] = usePersist("mc_chk_" + id, {});
  const numericServes = r && r.serves && /^\d+$/.test(r.serves) ? Number(r.serves) : null;
  const [target, setTarget] = useState(numericServes || 0);
  useEffect(() => { setTarget(numericServes || 0); window.scrollTo(0, 0); }, [id]);

  if (!r) { go("#/"); return null; }

  const factor = numericServes ? target / numericServes : 1;
  const nGroups = (r.ingredientGroups || []).length;
  const nIng = (r.ingredientGroups || []).reduce((a, g) => a + g.items.length, 0);
  const isSaved = saved.includes(r.id);
  const toggle = key => setChecks(c => ({ ...c, [key]: !c[key] }));

  const related = useMemo(() => {
    const ts = new Set(r.tags || []);
    return RECIPES.filter(x => x.id !== r.id).map(x => {
      let s = (x.tags || []).reduce((a, t) => a + (ts.has(t) ? 1 : 0), 0);
      if (x.course === r.course) s += 1;
      if (x.chef && x.chef === r.chef) s += 2;
      return [x, s];
    }).filter(p => p[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(p => p[0]);
  }, [id]);

  const initials = (r.chef || "MC").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <main className="reader">
      <div className="wrap">
        <a className="backlink" onClick={() => go("#/")}><I.back /> Back to all recipes</a>

        <section className="hero">
          <div>
            <div className="label kicker">{r.course}{r.season != null ? " · Season " + r.season : " · Earlier"}</div>
            <h1>{r.title}</h1>
            <div className="chefchip">
              {r.chefThumb ? <img src={r.chefThumb} alt={r.chef || ""} onError={e => { e.target.style.display = "none"; }} />
                : <span className="avt">{initials}</span>}
              <div>
                <div className="nm">{r.chef || "MasterChef Australia"}</div>
                <div className="rl">{[r.chefRole, r.published].filter(Boolean).join(" · ") || "Recipe"}</div>
              </div>
            </div>
          </div>
          <div className="hero-photo"><Img src={r.image} alt={r.title} /></div>
        </section>

        <section className="specstrip">
          {numericServes ? <div className="item"><div className="v">{target}</div><div className="k">Serves</div></div>
            : r.serves ? <div className="item"><div className="v" style={{ fontSize: "1.15rem" }}>{r.serves}</div><div className="k">Serves</div></div> : null}
          <div className="item"><div className="v">{nGroups}</div><div className="k">Component{nGroups === 1 ? "" : "s"}</div></div>
          <div className="item"><div className="v">{nIng}</div><div className="k">Ingredients</div></div>
          <div className="item"><div className="v">{r.season != null ? r.season : "—"}</div><div className="k">Season</div></div>
        </section>

        <div className="reader-body">
          <aside className="panel">
            <div className="panel-head">
              <h2>Ingredients</h2>
              <button className="reset" onClick={() => setChecks({})}>Reset</button>
            </div>

            <div className="scaler">
              {numericServes ? <>
                <span className="lbl">Scale to serve</span>
                <span className="stepper">
                  <button disabled={target <= 1} onClick={() => setTarget(t => Math.max(1, t - 1))} aria-label="Fewer servings">−</button>
                  <span className="val">{target}</span>
                  <button disabled={target >= 40} onClick={() => setTarget(t => Math.min(40, t + 1))} aria-label="More servings">+</button>
                </span>
              </> : <span className="lbl dim">Serves {r.serves || "—"} · scaling unavailable</span>}
            </div>

            {(r.ingredientGroups || []).map((g, gi) =>
              <IngredientGroup key={gi} g={g} gi={gi} factor={factor} checks={checks} toggle={toggle} />)}

            <div className="panel-foot">
              <button className={"btn ghost"} onClick={() => onSave(r.id)} style={isSaved ? { borderColor: "var(--accent)", color: "var(--accent)" } : null}>
                <I.heart fill={isSaved ? 1 : 0} /> {isSaved ? "Saved" : "Save"}
              </button>
              <a className="btn" href={r.url} target="_blank" rel="noopener noreferrer"><I.ext /> Cook on 10 Play</a>
            </div>
          </aside>

          <div>
            <div className="methodcard">
              <div className="label">Method</div>
              <h2>Cook it from the source.</h2>
              <p>We index the ingredients and the details — but the step-by-step method stays where it
                belongs, on Network 10's original recipe page. One tap and you're cooking.</p>
              <a className="btn" href={r.url} target="_blank" rel="noopener noreferrer"><I.ext /> Open the full method on 10 Play</a>
              <p className="why">Why the link-out? The method is 10's copyrighted writing. Ingredient lists are
                factual, so we surface those here to help you plan and shop.</p>
            </div>

            {r.tags && r.tags.length > 0 && <>
              <div className="sectionhead">Tagged</div>
              <div className="tags">
                {r.tags.map(t => <a key={t} className="tag" onClick={() => { localStorage.setItem("mc_q", JSON.stringify(t)); go("#/"); }}>{t}</a>)}
              </div>
            </>}

            <div className="source">
              <div className="txt">Recipe by <b>{r.chef || "a MasterChef Australia contestant"}</b>
                {r.season != null ? <>, Season {r.season}</> : ""}. Originally published by <b>Network 10</b>
                {r.published ? <> on {r.published}</> : ""}.</div>
              <a className="btn ghost" href={r.url} target="_blank" rel="noopener noreferrer"><I.ext /> Original on 10 Play</a>
            </div>
          </div>
        </div>

        {related.length > 0 && <section className="related">
          <div className="sectionhead">You might also cook</div>
          <div className="related-grid">
            {related.map(x => <Card key={x.id} r={x} saved={saved.includes(x.id)} onSave={onSave} />)}
          </div>
        </section>}
      </div>
    </main>
  );
}

/* =========================================================================
   Tweaks (appearance) — optional personalisation
   ========================================================================= */
const ACCENTS = ["default", "terracotta", "cobalt", "gold", "sage", "plum", "berry"];
const ACCENT_HEX = { default: "var(--accent)", terracotta: "#c0623f", cobalt: "#3a5be0", gold: "#d4a531", sage: "#7f9b6e", plum: "#9a4d86", berry: "#d23b54" };

function Tweaks({ onClose }) {
  const [, force] = useState(0);
  const root = document.documentElement;
  const set = (attr, val) => {
    root.setAttribute(attr, val);
    localStorage.setItem("mc_" + attr, val);
    if (attr === "data-layout") window.dispatchEvent(new Event("layoutchange"));
    force(x => x + 1);
  };
  const setScale = v => { root.style.setProperty("--scale", v); localStorage.setItem("mc_scale", v); force(x => x + 1); };
  const get = a => root.getAttribute(a);
  const scale = getComputedStyle(root).getPropertyValue("--scale").trim() || "1";

  const Opt = ({ attr, val, label }) =>
    <button className={"chip" + (get(attr) === val ? " on" : "")} onClick={() => set(attr, val)}>{label}</button>;

  return (
    <div className="tweaks" onClick={onClose}>
      <div className="scrim" />
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <h2>Appearance</h2>
        <div className="sub">Make it yours. Defaults: The Pass, Grotesk, Mosaic.</div>

        <div className="tw-row"><span className="label">Theme</span><div className="tw-opts">
          <Opt attr="data-theme" val="pass" label="The Pass" />
          <Opt attr="data-theme" val="editorial" label="Editorial" />
          <Opt attr="data-theme" val="modern" label="Modern" />
        </div></div>

        <div className="tw-row"><span className="label">Accent</span><div className="tw-opts">
          {ACCENTS.map(a => <button key={a} title={a}
            className={"swatch" + ((get("data-accent") || "default") === a ? " on" : "")}
            style={{ background: ACCENT_HEX[a] }} onClick={() => set("data-accent", a)} />)}
        </div></div>

        <div className="tw-row"><span className="label">Headline font</span><div className="tw-opts">
          <Opt attr="data-font" val="grotesk" label="Grotesk" />
          <Opt attr="data-font" val="serif" label="Serif" />
        </div></div>

        <div className="tw-row"><span className="label">Browse layout</span><div className="tw-opts">
          <Opt attr="data-layout" val="mosaic" label="Mosaic" />
          <Opt attr="data-layout" val="grid" label="Grid" />
        </div></div>

        <div className="tw-row"><span className="label">Text size</span><div className="tw-opts">
          {[["0.88","S"],["1","M"],["1.08","L"],["1.18","XL"]].map(([v, l]) =>
            <button key={v} className={"chip" + (Math.abs(parseFloat(scale) - parseFloat(v)) < 0.01 ? " on" : "")} onClick={() => setScale(v)}>{l}</button>)}
        </div></div>

        <button className="btn" style={{ width: "100%", marginTop: 24 }} onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

/* =========================================================================
   App shell
   ========================================================================= */
function App() {
  const hash = useHashRoute();
  const [saved, setSaved] = usePersist("mc_saved", []);
  const [tweaks, setTweaks] = useState(false);

  const onSave = useCallback(id =>
    setSaved(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]), [setSaved]);

  const m = hash.match(/^#\/r\/(.+)$/);
  const view = m ? "reader" : "browse";

  // GA4 virtual pageviews on hash navigation (initial view is sent by gtag config)
  const firstView = useRef(true);
  useEffect(() => {
    if (!window.gtag) return;
    if (firstView.current) { firstView.current = false; return; }
    window.gtag("event", "page_view", { page_location: location.href, page_title: document.title });
  }, [hash]);

  // restore browse scroll when returning from a reader
  useEffect(() => {
    if (view === "browse" && browseScroll) {
      const y = browseScroll; browseScroll = 0;
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
  }, [view]);

  return (
    <>
      <div className="topbar">
        <div className="wrap topbar-inner">
          <a className="brand" onClick={() => go("#/")}>
            <span className="dot" />The Pass <small>MasterChef AU</small>
          </a>
          <div className="topbar-spacer" />
          <button className="iconbtn" title="Appearance" onClick={() => setTweaks(true)}><I.sliders /></button>
        </div>
      </div>

      {view === "reader"
        ? <Reader id={m[1]} saved={saved} onSave={onSave} />
        : <Browse saved={saved} onSave={onSave} />}

      {tweaks && <Tweaks onClose={() => setTweaks(false)} />}

      <footer className="wrap" style={{ padding: "40px 0 60px", color: "var(--ink-faint)", fontSize: ".85rem", borderTop: "1px solid var(--line)" }}>
        <p>The Pass is an independent index of publicly published MasterChef Australia recipe pages.
          Recipes, photos and methods are © Network 10; every recipe links back to its original page on 10 Play.
          We surface only titles, ingredients and metadata to make the archive searchable.</p>
      </footer>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
