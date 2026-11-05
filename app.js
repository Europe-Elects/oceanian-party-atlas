/* Oceanian Party Atlas — reads data/parties.csv (built by the GitHub Action from the party database, Oceanian rows only) */
(() => {
const SOURCES = [
  "data/parties.csv",
];

// Columns shown. Everything from "Documented Links…" onward is ignored by design.
const C = {
  status: "Status", iso: "ISO-2", country: "Country", native: "Name (Native)", name: "Name (English)",
  id: "Europe Elects Entity ID", ver: "Europe Elects Entity Version", verId: "Entity Version ID",
  legal: "National Legal ID", abbr: "Abbreviation", ideo: "Ideological Orientation",
  minority: "Legally Recognized Minority Party", sep: "Separatist",
  started: "Political Activity Started", ep: "International Party Federation", epEnd: "International Affiliation End",
};
const SECTIONS = [
  ["Identity", ["Status","Country","Name (Native)","Name (English)","Abbreviation","National Legal ID"]],
  ["Profile", ["Ideological Orientation","Legally Recognized Minority Party","Separatist"]],
  ["Dates", ["Political Activity Started","Legal Entity Registration","Legal Entity Deregistration","Name Registration","Name Deregistration"]],
  ["International party federation", ["International Party Federation","International Affiliation Start","International Affiliation End"]],
];
// Europe Elects IDs are read for internal use only (latest version, stable dot positions) and never shown or searchable.
const KEEP = new Set([...SECTIONS.flatMap(s => s[1]), "ISO-2", "Europe Elects Entity ID", "Europe Elects Entity Version", "Entity Version ID", "Logo", "Logo URL", "Logo Override", "Wikidata ID"]);

// International party federations, coloured by political family (every mark is also labelled).
// Matched by name, so spelling variants in the database ("Liberal International", "LI") land on the same colour.
const FED = [
  [/socialist international|^si$/i, "Socialist International", "#E2001A"],
  [/progressive alliance|^pa$/i, "Progressive Alliance", "#FF6B6B"],
  [/liberal international|^li$/i, "Liberal International", "#F2C300"],
  [/democrat(ic)? union|^idu$/i, "International Democracy Union", "#1F5FBF"],
  [/centrist democrat|christian democrat|^cdi$/i, "Centrist Democrat International", "#3399FF"],
  [/green/i, "Global Greens", "#009900"],
  [/communist|workers.? part/i, "Communist & workers' parties", "#7C0000"],
  [/pirate/i, "Pirate Parties International", "#9c36b8"],
];
const OTHER_FED = ["#0B6B2E", "#8E44AD", "#D35400", "#16A085", "#7F8C8D", "#A93636"];
const fedName = v => { const f = FED.find(([re]) => re.test(v)); return f ? f[1] : v; };
const partyKey = v => fedName(v.replace(/\s*\(\d{4}\)\s*$/, "").trim());
const epLabel = k => k;
let FED_COLOR = Object.fromEntries(FED.map(f => [f[1], f[2]]));
const colorOf = k => FED_COLOR[k] || "#8A9099";
const EP = FED.map(f => [f[1], f[2]]);   // known federations in display order (used for hatching ids)
// Ideology colours, as on the country pages (first ideology of a combined entry counts).
const IDEO_COLOR = { "agrarianism": "#90ee90", "animal rights": "#009076", "centre-left": "#FF0000", "centre-right": "#3399FF",
  "centrism": "#fa8c00", "christian fundamentalism": "#a16585", "eurofederalism": "#502379", "far-left": "#7c0000",
  "far-right": "#70463A", "green politics": "#009900", "islamism": "#8A9099", "left-wing": "#990000", "liberalism": "#FFD700",
  "libertarianism": "#F2C300", "libertarian": "#F2C300", "monarchism": "#8A9099", "national conservatism": "#0000FF",
  "national-conservatism": "#0000FF", "pirate politics": "#9c36b8", "right-wing": "#000000", "regionalism": "#008080" };
const ideoColorOf = v => IDEO_COLOR[String(v).split(/[,;]/)[0].trim().toLowerCase()] || "#8A9099";

// ISO-2 → ISO 3166 numeric (world-atlas ids). Some small territories are present in the
// database but may not have a separate polygon at this map scale; they remain available in filters/table.
const NUM = {
  AU:"036", NZ:"554", PG:"598", FJ:"242", SB:"090", VU:"548", WS:"882", TO:"776", KI:"296",
  TV:"798", NR:"520", FM:"583", MH:"584", PW:"585", AS:"016", CK:"184", PF:"258", GU:"316",
  NC:"540", MP:"580", NF:"574", PN:"612", TK:"772", WF:"876", NU:"570", CX:"162", CC:"166",
  HM:"334", UM:"581"
};
const BY_NAME = {};
// Oceania subregions. These groupings are used as chart bands and filters.
const REGION = {};
[["Australia & New Zealand", "AU NZ CX CC NF HM"],
 ["Melanesia", "FJ NC PG SB VU"],
 ["Micronesia", "FM GU KI MH MP NR PW AS UM"],
 ["Polynesia", "CK NU PF PN TK TO TV WF WS"]]
 .forEach(([r, l]) => l.split(" ").forEach(c => (REGION[c] = r)));
const REGIONS = ["Australia & New Zealand", "Melanesia", "Micronesia", "Polynesia", "Other"];
const regionOf = r => REGION[r[C.iso]] || "Other";

const $ = s => document.querySelector(s);
const tip = $("#tip");
const clean = v => { v = (v ?? "").toString().replace(/[​-‍﻿]/g, "").trim(); return v; };
const isNone = v => !v || /^(unaffiliated|none|no|\*|-|–)$/i.test(v);
const fmt = d3.format(",");

let ALL = [], VIEW = [], state = { q: "", country: "", status: "active", ep: "", ideo: "", region: "", lean: false, latest: true };
let sort = { key: "country", asc: true }, shown = 100;

// ---------- load ----------
async function load() {
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) continue;
      const text = await res.text();
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      const rows = parsed.data.filter(r => clean(r["Europe Elects Entity ID"]) || clean(r["Name (English)"]));
      if (!rows.length) continue;
      const stamp = res.headers.get("last-modified");
      return { rows, url, stamp };
    } catch (e) { /* try next */ }
  }
  throw new Error("No data source reachable");
}

function normalise(r) {
  const o = {};
  // "*" in the database means unaffiliated
  for (const k of Object.keys(r)) if (KEEP.has(k)) { const v = clean(r[k]); o[k] = v === "*" ? "unaffiliated" : v; }
  o._status = (o.Status || "unknown").toLowerCase();
  // current federation membership (an end date means it's past)
  const mem = (o[C.ep] || "").split(/[,;]/)[0].trim();
  o._lean = false;
  o._ep = !isNone(mem) && !o[C.epEnd] ? partyKey(mem) : "";
  if (/^\d*$/.test(o._ep)) o._ep = "";
  o._region = REGION[o[C.iso]] || "Other";
  const y = parseInt((o[C.started] || "").match(/\d{4}/)?.[0], 10);
  o._year = Number.isFinite(y) ? y : null;
  o._ver = parseInt(o[C.ver], 10) || 1;
  o._search = [o[C.name], o[C.native], o[C.abbr], o[C.country], o[C.legal]].join(" ").toLowerCase();
  return o;
}

// ---------- filtering ----------
function apply() {
  const q = state.q.toLowerCase();
  VIEW = ALL.filter(r => r._status !== "realigned" && (!state.latest || r._latest) &&
    (!state.status || r._status === state.status) &&
    (!state.country || r[C.iso] === state.country) &&
    (!state.ep || r._ep === state.ep && (state.lean || !r._lean)) &&
    (!state.ideo || r[C.ideo] === state.ideo) &&
    (!state.region || r._region === state.region) &&
    (!q || r._search.includes(q)));
  shown = 100;
  renderAll();
  syncHash();
}
function syncHash() {
  const h = new URLSearchParams();
  for (const k of ["q", "country", "status", "ep", "ideo", "region"]) if (state[k]) h.set(k, state[k]);
  try { history.replaceState(null, "", "#" + h); } catch {}
}
const epOf = r => (r._ep && (state.lean || !r._lean)) ? r._ep : "";

function fillSelect(sel, values, label) {
  const cur = sel.value;
  sel.innerHTML = `<option value="">${label}</option>` + values.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("");
  sel.value = cur;
}
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- tooltip ----------
function showTip(ev, html) { tip.innerHTML = html; tip.style.opacity = 1; moveTip(ev); }
function moveTip(ev) {
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + w > innerWidth - 8) x = ev.clientX - w - 14;
  if (y + h > innerHeight - 8) y = ev.clientY - h - 14;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
const hideTip = () => (tip.style.opacity = 0);

// ---------- KPIs ----------
function renderKPIs() {
  const ids = new Set(VIEW.map(r => r[C.id]));
  const countries = new Set(VIEW.map(r => r[C.iso]).filter(Boolean));
  const withEP = VIEW.filter(r => r._ep && !r._lean).length;
  const sep = VIEW.filter(r => /^yes/i.test(r[C.sep])).length;
  // The column names the minority ("Albanian", "German", …) or says "No".
  const minority = VIEW.filter(r => !isNone(r[C.minority])).length;
  const k = [
    [fmt(VIEW.length), "rows in view"], [fmt(ids.size), "distinct entities"], [fmt(countries.size), "countries & territories"],
    [VIEW.length ? Math.round(100 * withEP / VIEW.length) + "%" : "–", "in an international federation"],
    [fmt(minority), "recognised minority parties"], [fmt(sep), "separatist"],
  ];
  $("#kpis").innerHTML = k.map(([v, l]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");
}

// ---------- map ----------
let world = null;
// The base map (Natural Earth) draws Crimea as part of Russia. Move it to Ukraine and dissolve the border.
// Natural Earth draws Northern Cyprus as a separate country. Merge it into Cyprus.
function cyprusUnited(topo) {
  try {
    const geos = topo.objects.countries.geometries;
    const cy = geos.find(g => String(g.id) === "196"), nc = geos.find(g => g.properties && g.properties.name === "N. Cyprus");
    if (!cy || !nc) return;
    const merged = topojson.mergeArcs(topo, [cy, nc]);
    cy.type = merged.type; cy.arcs = merged.arcs;
    geos.splice(geos.indexOf(nc), 1);
  } catch (e) { /* keep the map as it is */ }
}
function somaliaUnited(topo) {
  try {
    const geos = topo.objects.countries.geometries;
    const so = geos.find(g => String(g.id) === "706"), sl = geos.find(g => g.properties && g.properties.name === "Somaliland");
    if (!so || !sl) return;
    const merged = topojson.mergeArcs(topo, [so, sl]);
    so.type = merged.type; so.arcs = merged.arcs;
    geos.splice(geos.indexOf(sl), 1);
  } catch (e) { /* keep the map as it is */ }
}
function ukraineWithCrimea(topo) {
  try {
    const geos = topo.objects.countries.geometries;
    const ru = geos.find(g => String(g.id) === "643"), ua = geos.find(g => String(g.id) === "804");
    if (!ru || !ua || ru.type !== "MultiPolygon") return;
    const point = [34.1, 45.3]; // central Crimea
    const i = ru.arcs.findIndex(poly => d3.geoContains(topojson.feature(topo, { type: "Polygon", arcs: poly }), point));
    if (i < 0) return;
    const crimea = { type: "Polygon", arcs: ru.arcs[i] };
    ru.arcs.splice(i, 1);
    const merged = topojson.mergeArcs(topo, [ua, crimea]);
    ua.type = merged.type; ua.arcs = merged.arcs;
  } catch (e) { /* keep the map as it is */ }
}
async function loadWorld() {
  if (world) return world;
  const topo = await d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json");
  // Draw Australia, New Zealand and the Pacific island region. Longitudes are tested on
  // both sides of the antimeridian so Polynesian islands are included.
  world = topojson.feature(topo, topo.objects.countries).features
    .filter(f => {
      const c = d3.geoCentroid(f);
      return (c[0] >= 90 || c[0] <= -100) && c[1] >= -50 && c[1] <= 30;
    });
  return world;
}
async function renderMap() {
  const el = $("#map");
  let feats;
  try { feats = await loadWorld(); } catch { el.innerHTML = `<p class="sub">Map unavailable offline.</p>`; return; }
  // colour by counts ignoring the country filter, so the map stays useful when one is selected
  const base = ALL.filter(r => r._status !== "realigned" && (!state.latest || r._latest) && (!state.status || r._status === state.status) && (!state.ep || r._ep === state.ep) && (!state.ideo || r[C.ideo] === state.ideo) && (!state.region || r._region === state.region) && (!state.q || r._search.includes(state.q.toLowerCase())));
  const cnt = d3.rollup(base, v => v.length, r => r[C.iso]);
  const iso2ByNum = Object.fromEntries(Object.entries(NUM).map(([a, n]) => [n, a]));
  const iso2ByName = Object.fromEntries(Object.entries(BY_NAME).map(([a, n]) => [n, a]));
  const names = Object.fromEntries(ALL.map(r => [r[C.iso], r[C.country]]));
  const iso2ByCountry = Object.fromEntries(ALL.map(r => [String(r[C.country]).toLowerCase(), r[C.iso]]));
  const isoOf = f => iso2ByNum[f.id] || iso2ByName[f.properties.name] || iso2ByCountry[String(f.properties.name).toLowerCase()] || null;

  const W = el.clientWidth || 800, H = el.clientHeight || 600;
  const proj = d3.geoMercator().center([160, -5]);
  proj.fitExtent([[4, 4], [W - 4, H - 4]], { type: "MultiPoint", coordinates: [[105, -48], [-110, 28]] });
  const path = d3.geoPath(proj);
  const max = d3.max(cnt.values()) || 1;
  // Colour follows the selected federation or ideology (same colours as elsewhere); red otherwise.
  const hue = state.ep ? colorOf(state.ep) : state.ideo ? ideoColorOf(state.ideo) : "#A93636";
  const hc = d3.hsl(hue), end = (hc.l > 0.45 ? hc.darker(hc.l > 0.6 ? 1.3 : 0.6) : hc).formatHex();
  const start = d3.interpolateRgb("#FFFFFF", hue)(0.18);
  const color = d3.scaleSequentialLog([1, Math.max(2, max)], d3.interpolateRgb(start, end));

  const svg = d3.select(el).selectAll("svg").data([0]).join("svg").attr("viewBox", `0 0 ${W} ${H}`);
  svg.selectAll("path.c").data(feats, d => d.id + (d.properties.name || ""))
    .join("path").attr("class", "c").attr("d", path)
    .attr("fill", d => { const n = cnt.get(isoOf(d)); return n ? color(n) : "var(--map-empty)"; })
    .classed("sel", d => state.country && isoOf(d) === state.country)
    .on("mousemove", (ev, d) => {
      const iso = isoOf(d), n = cnt.get(iso) || 0;
      showTip(ev, `<b>${esc(names[iso] || d.properties.name)}</b><br><span class="m">${n ? fmt(n) + " entities" : "No entries in view"}</span>`);
    })
    .on("mouseleave", hideTip)
    .on("click", (ev, d) => { const iso = isoOf(d); if (!cnt.get(iso)) return; setCountry(state.country === iso ? "" : iso); });
  svg.selectAll("path.c.sel").raise();
  $("#map-legend").innerHTML = `<span>1</span><span class="bar" style="background:linear-gradient(90deg,${start},${end})"></span><span>${fmt(max)} ${state.ep ? esc(state.ep) + " members" : state.ideo ? esc(state.ideo) + " parties" : "entities"} (log scale)</span>`;
}
function setCountry(iso) { state.country = iso; $("#f-country").value = iso; apply(); }

// ---------- generic horizontal bars ----------
function hbars(el, data, { color = "#2A5DB0", onClick, active, label = d => d.key, valueFmt = fmt } = {}) {
  const host = d3.select(el); host.selectAll("*").remove();
  if (!data.length) { host.append("p").attr("class", "sub").text("Nothing in view."); return; }
  const W = el.clientWidth || 360, row = 26, lw = Math.min(260, W * 0.42), pad = 40, maxChars = W > 700 ? 42 : 26;
  const H = data.length * row + 4;
  const x = d3.scaleLinear([0, d3.max(data, d => d.value)], [0, W - lw - pad]);
  const svg = host.append("svg").attr("width", W).attr("height", H);
  const g = svg.selectAll("g").data(data).join("g").attr("transform", (d, i) => `translate(0,${i * row})`);
  g.append("rect").attr("class", "hit").attr("width", W).attr("height", row);
  g.append("text").attr("class", "lbl" + (onClick ? " clickable" : "")).attr("x", lw - 8).attr("y", row / 2).attr("dy", ".35em").attr("text-anchor", "end")
    .text(d => trunc(label(d), maxChars)).style("font-weight", d => active && active(d) ? 600 : null);
  g.append("rect").attr("x", lw).attr("y", 5).attr("height", row - 10).attr("rx", 3)
    .attr("width", d => Math.max(2, x(d.value))).attr("fill", d => typeof color === "function" ? color(d) : color)
    .attr("opacity", d => active && state.ideo && !active(d) ? 0.35 : 1);
  g.append("text").attr("class", "val").attr("x", d => lw + Math.max(2, x(d.value)) + 6).attr("y", row / 2).attr("dy", ".35em").text(d => valueFmt(d.value));
  g.on("mousemove", (ev, d) => showTip(ev, `<b>${esc(label(d))}</b><br><span class="m">${fmt(d.value)} entities</span>`)).on("mouseleave", hideTip);
  if (onClick) g.style("cursor", "pointer").on("click", (ev, d) => onClick(d));
}
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// ---------- EP totals ----------
function hatchDefs(svg) {
  const defs = svg.append("defs");
  [...EP, ["x", "#8A9099"]].forEach(([k, c], i) => { if (k === "x") i = "x";
    const p = defs.append("pattern").attr("id", "h" + i).attr("patternUnits", "userSpaceOnUse").attr("width", 6).attr("height", 6).attr("patternTransform", "rotate(45)");
    p.append("rect").attr("width", 6).attr("height", 6).attr("fill", c).attr("opacity", 0.35);
    p.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6).attr("stroke", c).attr("stroke-width", 3);
  });
}
const hatchOf = k => { const i = EP.findIndex(e => e[0] === k); return i < 0 ? "url(#hx)" : `url(#h${i})`; };

function renderEPTotal() {
  const el = $("#ep-total"), host = d3.select(el); host.selectAll("*").remove();
  const keys = [...new Set(VIEW.map(r => r._ep).filter(Boolean))];
  const groups = keys.map(k => {
    const rows = VIEW.filter(r => r._ep === k && (state.lean || !r._lean));
    return { key: k, firm: rows.filter(r => !r._lean).length, lean: rows.filter(r => r._lean).length, color: colorOf(k) };
  }).filter(d => d.firm + d.lean).sort((a, b) => (b.firm + b.lean) - (a.firm + a.lean));
  if (!groups.length) { host.append("p").attr("class", "sub").text("No federation members in view."); return; }
  const W = el.clientWidth || 360, row = 30, lw = Math.min(190, W * 0.48), pad = 40, H = groups.length * row;
  const x = d3.scaleLinear([0, d3.max(groups, d => d.firm + d.lean)], [0, W - lw - pad]);
  const svg = host.append("svg").attr("width", W).attr("height", H); hatchDefs(svg);
  const g = svg.selectAll("g.r").data(groups).join("g").attr("class", "r").attr("transform", (d, i) => `translate(0,${i * row})`).style("cursor", "pointer");
  g.append("rect").attr("class", "hit").attr("width", W).attr("height", row);
  g.append("text").attr("x", lw - 8).attr("y", row / 2).attr("dy", ".35em").attr("text-anchor", "end").text(d => trunc(d.key, 24))
    .style("font-weight", d => state.ep === d.key ? 700 : 600).style("fill", "var(--ink)");
  g.append("rect").attr("x", lw).attr("y", 6).attr("height", row - 12).attr("rx", 3).attr("width", d => Math.max(2, x(d.firm))).attr("fill", d => d.color);
  g.append("rect").attr("x", d => lw + x(d.firm) + (d.firm ? 2 : 0)).attr("y", 6).attr("height", row - 12).attr("rx", 3)
    .attr("width", d => d.lean ? Math.max(2, x(d.lean) - 2) : 0).attr("fill", d => hatchOf(d.key));
  g.append("text").attr("class", "val").attr("x", d => lw + x(d.firm + d.lean) + 6).attr("y", row / 2).attr("dy", ".35em").text(d => fmt(d.firm + d.lean));
  g.on("mousemove", (ev, d) => showTip(ev, `<b>${esc(d.key)}</b><br>${fmt(d.firm)} member parties<br><span class="m">Click to filter</span>`))
   .on("mouseleave", hideTip)
   .on("click", (ev, d) => { state.ep = state.ep === d.key ? "" : d.key; $("#f-ep").value = state.ep; apply(); });
}

// ---------- left–right spectrum ----------
// Ideological orientation → position on a 0 (far-left) … 10 (far-right) scale. Unmatched labels are listed as "not placed".
const LR_RULES = [
  // specific families first, so the broader rules below don't catch them
  [/animal/i, 2.3],                                   // animal welfare / animal rights: between Left and Greens
  [/christian[- ]?fundamental/i, 7.4],                 // placed where ECR / national-conservatives sit
  [/pirate/i, 3.4],                                    // centre-left
  [/euro-?federal/i, 3.4],                             // centre-left
  [/far[- ]?left|communis|marxis|trotsk|anti-capital/i, 0.6],
  [/far[- ]?right|neo-?fascis|ultra-?national/i, 9.4],
  [/centre[- ]?left|center[- ]?left|social[- ]?democra|labou?r/i, 3.4],
  [/centre[- ]?right|center[- ]?right|christian[- ]?democra|liberal[- ]?conservat/i, 6.6],
  [/left[- ]?wing|democratic socialis|socialis|eco-?socialis/i, 1.8],
  [/national[- ]?conservat/i, 7.4],
  [/right[- ]?wing|nationalis|monarchis|right[- ]?populis|sovereign/i, 8.2],
  [/green|ecolog|environment/i, 2.8],
  [/agrarian/i, 5.6],
  [/liberal|libertarian/i, 5.6],
  [/conservat/i, 7.3],
  [/centris|centre|center|pro-?europe/i, 5.0],
];
const LR_TICKS = [[0.6, "Far-left", "FL"], [1.8, "Left", "L"], [3.4, "Centre-left", "CL"], [5, "Centre", "C"], [6.6, "Centre-right", "CR"], [7.4, "Nat.-cons.", "NC"], [8.2, "Right", "R"], [9.4, "Far-right", "FR"]];
const SHORT_BAND = { "Strongly in favour": "Strongly for", "In favour": "For", "Somewhat in favour": "Somewhat for", "Somewhat opposed": "Somewhat against", "Opposed": "Against", "Strongly opposed": "Strongly against", "No stance recorded": "No stance" };
const hash = str => { let h = 2166136261; for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const lrOf = r => { const v = r[C.ideo] || ""; for (const [re, x] of LR_RULES) if (re.test(v)) return x; return null; };

// EP group ring colours (actual EP group membership).
const EPG = [["EPP", "#3399FF"], ["S&D", "#FF0000"], ["RE", "#FFD700"], ["Greens/EFA", "#009900"], ["ECR", "#0000FF"], ["PfE", "#000000"], ["ESN", "#70463A"], ["LEFT", "#990000"], ["NI", "#8A9099"]];
const EPG_COLOR = Object.fromEntries(EPG);
const EPG_ALIAS = { "RENEW": "RE", "RENEW EUROPE": "RE", "GREENS": "Greens/EFA", "GUE/NGL": "LEFT", "THE LEFT": "LEFT", "LEFT": "LEFT", "PATRIOTS": "PfE", "PATRIOTS FOR EUROPE": "PfE", "NON-INSCRITS": "NI" };
const epgOf = r => { const v = (r["European Parliament Group"] || "").split(/[;,]/)[0].trim(); if (isNone(v) || r["EP Group End"]) return ""; return EPG_ALIAS[v.toUpperCase()] || v; };

function renderSpectrum() {
  const fillSw = (c, o = 1) => `<i style="background:${c};opacity:${o};border-radius:50%"></i>`;
  const feds = [...new Set(ALL.map(r => r._ep).filter(Boolean))].sort((x, y) => d3.ascending(x, y));
  $("#lr-legend").innerHTML = `<div><b>Colour · international federation</b> ${feds.map(k => `<span>${fillSw(colorOf(k))}${esc(k)}</span>`).join("")}<span>${fillSw("var(--neutral)")}None</span></div>`;

  const el = $("#lr"), host = d3.select(el); host.selectAll("*").remove();
  const placed = VIEW.filter(r => lrOf(r) != null), unplaced = VIEW.length - placed.length;
  const unplacedLabels = d3.rollups(VIEW.filter(r => lrOf(r) == null), v => v.length, r => r[C.ideo] || "not recorded").sort((a, b) => b[1] - a[1]);
  $("#lr-note").textContent = unplaced ? `${fmt(unplaced)} not placed (${unplacedLabels.slice(0, 4).map(([k, n]) => `${k} ${n}`).join(", ")}${unplacedLabels.length > 4 ? ", …" : ""}).` : "";
  if (!placed.length) { host.append("p").attr("class", "sub").text("No parties with a left–right placement in view."); return; }

  const W = el.clientWidth || 900, narrow = W < 640, lw = narrow ? 92 : Math.min(150, W * 0.3), pr = 16, top = 26;
  const R = placed.length > 900 ? 3.5 : placed.length > 350 ? 4.5 : 6;
  const x = d3.scaleLinear([0, 10], [lw + R + 4, W - pr - R]);
  const unit = x(1) - x(0), jx = Math.max(R, unit * 0.22), jmax = Math.max(R * 1.5, unit * 0.4); // horizontal scatter range
  // Rows = EU integration stance (most in favour on top), plus a band for parties with no recorded stance.
  const BANDS = REGIONS.filter(n => n !== "Other" || placed.some(r => r._region === "Other"));
  const groups = BANDS.map((name, bi) => ({ name, bi, rows: placed.filter(r => r._region === name) }));

  // Each band is a beeswarm: dots pulled to their ideology position, collisions spread them up and down.
  let y0 = top;
  for (const g of groups) {
    // Stable pseudo-random jitter per party, so dots don't jump around between renders.
    const nodes = g.rows.map(r => {
      const h = hash(r[C.verId] || r[C.id] || r[C.name]);
      const tx = x(lrOf(r)) + (((h % 1000) / 1000) - 0.5) * jx * 2;
      return { r, tx, x: tx, y: ((((h >> 10) % 1000) / 1000) - 0.5) * 2 * R };
    });
    if (nodes.length) {
      const sim = d3.forceSimulation(nodes).force("x", d3.forceX(d => d.tx).strength(0.12)).force("y", d3.forceY(0).strength(0.05))
        .force("c", d3.forceCollide(R + 1.8).iterations(2)).stop();
      for (let i = 0; i < 220; i++) {
        sim.tick();
        nodes.forEach(n => (n.x = Math.max(n.tx - jmax, Math.min(n.tx + jmax, n.x)))); // stay near the ideology column
      }
      nodes.forEach(n => (n.x = Math.max(lw + R + 4, Math.min(W - pr - R, n.x))));
    }
    const [mn, mx] = nodes.length ? d3.extent(nodes, n => n.y) : [0, 0];
    const h = Math.max(36, mx - mn + 2 * R + 14);
    nodes.forEach(n => (n.y = y0 + h / 2 + n.y - (mn + mx) / 2));
    Object.assign(g, { nodes, y: y0, h }); y0 += h;
  }
  const H = y0 + 6;
  const svg = host.append("svg").attr("width", W).attr("height", H);

  // column grid (left–right) and row bands (EU stance)
  svg.append("g").selectAll("rect").data(groups).join("rect").attr("x", lw).attr("width", W - lw).attr("y", d => d.y).attr("height", d => d.h)
    .attr("fill", d => (d.bi % 2 ? "var(--wash)" : "transparent")).attr("opacity", 0.6);
  svg.append("g").attr("class", "grid").selectAll("line").data(LR_TICKS).join("line")
    .attr("x1", d => x(d[0])).attr("x2", d => x(d[0])).attr("y1", top - 4).attr("y2", H);
  svg.append("g").selectAll("text").data(LR_TICKS).join("text").attr("x", d => x(d[0])).attr("y", 14).attr("text-anchor", "middle").attr("data-full", d => d[1])
    .style("fill", "var(--blue)").style("font-size", narrow ? "11px" : "13px").style("font-weight", 700).text(d => narrow ? d[2] : d[1]);

  const row = svg.selectAll("g.row").data(groups).join("g").attr("class", "row");
  row.append("rect").attr("x", lw - 10).attr("width", 4).attr("rx", 2).attr("y", d => d.y + 6).attr("height", d => d.h - 12)
    .attr("fill", d => ["#1C1C1C", "#D04848", "#0B6B2E", "#F2C200", "#A93636", "transparent"][d.bi]);
  row.append("text").attr("x", lw - 18).attr("y", d => d.y + d.h / 2).attr("dy", ".35em").attr("text-anchor", "end")
    .style("fill", "var(--ink-2)").style("font-size", narrow ? "12px" : null).text(d => d.name);
  row.append("text").attr("x", W - pr).attr("y", d => d.y + 12).attr("text-anchor", "end").style("fill", "var(--muted)").style("font-size", "11px")
    .text(d => d.rows.length ? "n=" + d.rows.length : "");
  svg.append("text").attr("x", lw - 18).attr("y", 14).attr("text-anchor", "end").style("fill", "var(--muted)").style("font-size", "11px").text("Region");

  const nodes = groups.flatMap(g => g.nodes);
  svg.append("g").selectAll("circle").data(nodes).join("circle")
    .attr("cx", n => n.x).attr("cy", n => n.y).attr("r", R)
    .attr("fill", n => epOf(n.r) ? colorOf(epOf(n.r)) : "var(--neutral)")
    .attr("stroke", "#fff").attr("stroke-width", 1)
    .style("cursor", "pointer")
    .on("mousemove", (ev, n) => {
      const r = n.r;
      showTip(ev, `<b>${esc(r[C.name])}</b>${r[C.abbr] ? ` (${esc(r[C.abbr])})` : ""}<br><span class="m">${esc(r[C.country])} · ${esc(r[C.ideo])}</span><br>International federation: ${r._ep ? esc(r._ep) : "none"}`);
    })
    .on("mouseleave", hideTip).on("click", (ev, n) => openDrawer(n.r));
}

// Ideology definitions, identical to the country pages: [name, colour, definition].
const IDEOLOGY_DEFS = [
 [
  "Agrarianism",
  "#90ee90",
  "Agrarian parties are political movements whose primary political concern is the representation of farmers, rural communities, and agricultural producers, often advocating for stronger support for domestic food production and regional development. They tend to emphasize rural representation, decentralization, and policies aimed at protecting farmers from economic pressures, whether from global markets, urban elites, or regulation, with agricultural interests typically taking precedence over broader ideological positioning. While they can range from centre-left to conservative, they are generally united by a belief that agriculture and rural life deserve a stronger political voice and protection."
 ],
 [
  "Animal rights",
  "#009076",
  "Animal rights parties are political movements whose primary political concern is the protection of animals, animal welfare, and the ethical relationship between humans, animals, and nature. They tend to advocate stronger animal protection laws, more sustainable environmental policies, and ethical reforms in areas such as agriculture, food production, scientific testing, and biodiversity. They overlap ideologically with Green politics and left-wing politics, but distinguish themselves by placing animal welfare and animal rights at the centre of their political agenda rather than treating them as secondary issues within broader environmental or social programmes."
 ],
 [
  "Centre-left",
  "#FF0000",
  "Centre-left parties are political movements whose primary political concern is the promotion of social justice, economic equality, and strong public institutions within a democratic political framework. They tend to advocate redistributive economic policies, expansive welfare states, labour rights, public investment in healthcare and education, and protections for disadvantaged groups, while generally supporting a mixed economy that combines market mechanisms with state intervention. They distinguish themselves from more radical left-wing parties by accepting parliamentary democracy, political pluralism, and a mixed-market economy rather than seeking a fundamental transformation of capitalism, while distinguishing themselves from centre-right and centrist parties by placing greater emphasis on redistribution, public services, labour protections, and reducing social and economic inequalities."
 ],
 [
  "Centre-right",
  "#3399FF",
  "Centre-right parties are political movements whose primary political concern is the promotion of social stability, economic responsibility, democratic institutions, and often values rooted in Christian democracy, liberal conservatism, or civic patriotism. They tend to advocate market-oriented economies, strong but limited government, support for heteronormative families and civil society, and gradual reform, while often combining economic liberalism with a commitment to social cohesion and institutional continuity. They distinguish themselves from centrist and centre-left parties by placing greater emphasis on market economics, lower taxation, individual responsibility, traditional social values, and more restrained state intervention in the economy, while distinguishing themselves from national-conservative and right-wing parties by typically supporting liberal democracy, international cooperation, political moderation, and a more inclusive or institution-oriented understanding of national identity."
 ],
 [
  "Centrism",
  "#fa8c00",
  "Centrist and liberal-centre parties are political movements whose primary political concern is the promotion of political moderation as well as economic and social policies that avoid ideological extremes. They tend to advocate institutional reform, civil liberties, pro-European or international cooperation, and mixed economic approaches that combine market mechanisms with targeted state intervention. They distinguish themselves from centre-right and conservative parties by placing greater emphasis on political reform, social liberalism, environmental sustainability, and a more active role for the state in addressing inequality or modernisation, while distinguishing themselves from centre-left parties by generally favouring market economics, fiscal moderation, and incremental political and economic change."
 ],
 [
  "Christian fundamentalism",
  "#a16585",
  "Christian fundamentalist parties are political movements whose primary political concern is the preservation of religiously informed public ethics and socially conservative understandings of family and community. They tend to advocate policies rooted in Christian or religious values, often viewing the Christian Bible as a foundational guide for policymaking, alongside support for traditional family structures, cultural continuity, and a cautious approach to rapid social change, frequently opposing the liberalization of issues such as abortion, euthanasia, or changes to marriage and gender norms. They distinguish themselves from national-conservative parties by placing greater emphasis on religious doctrine and biblical morality rather than national identity, sovereignty, or cultural nationalism, while distinguishing themselves from broader centre-right parties by giving moral and religious values precedence over economic liberalism, pragmatic governance, or broad ideological coalitions. They further distinguish themselves from centre-left parties by promoting a vision of social justice rooted more in charity, community responsibility, and faith-based solidarity than in redistribution, labour politics, or class-based bargaining."
 ],
 [
  "Eurofederalism",
  "#502379",
  "European federalist parties are political movements whose primary political concern is the deepening of European integration and the strengthening of supranational democratic governance across Europe. They tend to advocate a more politically integrated or federal European Union, stronger common institutions, transnational democracy, coordinated responses to challenges such as climate change and migration, and policies that transcend traditional national politics. They distinguish themselves from mainstream centrist and pro-European parties by placing European integration itself at the centre of their political agenda, often advocating far-reaching institutional reform or federalism, while distinguishing themselves from Eurosceptic and nationalist parties by viewing shared sovereignty, cross-border cooperation, and a stronger European political identity as solutions rather than threats to democracy and prosperity."
 ],
 [
  "Far-left",
  "#7c0000",
  "Far-left parties are political movements whose primary political concern is the transformation or replacement of capitalist economic systems in favour of socialism, communism, or other forms of collective economic organization. They tend to advocate strong public or collective ownership of key industries, extensive workers’ rights, economic planning, anti-imperialism, and a rapid or far-reaching restructuring of capitalist economies, often viewing liberal capitalism as inherently exploitative and class-based inequality as a central political problem. They distinguish themselves from broader left-wing parties by rejecting the institutions of liberal democratic capitalism as insufficient for achieving social and economic equality, often favouring revolutionary change, workers’ democracy, or alternative political models over parliamentary democracy within the capitalist system."
 ],
 [
  "Far-right",
  "#70463A",
  "Far-right parties are political movements whose primary political concern is the protection of national identity, cultural homogeneity, sovereignty, and traditional social order, often framed as a response to perceived threats from immigration, multiculturalism, globalization, or supranational institutions. They tend to advocate restrictive immigration policies, strong law-and-order approaches, national preference in welfare and economics, social conservatism, and skepticism or rejection of international organizations, while emphasizing cultural traditionalism and national sovereignty over liberal democratic constraints and, in some cases, questioning multiparty parliamentarism in favour of stronger majoritarian, leader-centred, or ethnically defined conceptions of political representation. They distinguish themselves from mainstream right-wing and national-conservative parties by embracing more exclusionary or ethnonationalist conceptions of national identity and by displaying greater skepticism toward multiparty parliamentary democracy itself, often favouring stronger executive authority, plebiscitary leadership, or political systems that subordinate pluralism to a unified conception of the nation."
 ],
 [
  "Green politics",
  "#009900",
  "Green parties are political movements whose primary political concern is environmental sustainability, climate protection, and the ecological transformation of society and the economy, typically paired with social progressivism and centre-left economic politics. They tend to advocate ambitious climate action, renewable energy, biodiversity protection, sustainable economic development, social justice, and participatory democracy, often linking environmental concerns with progressive positions on human rights, equality, and international cooperation. They distinguish themselves from centre-left and social democratic parties by placing ecological sustainability and long-term environmental limits at the centre of policymaking rather than treating them as one priority among many, while distinguishing themselves from animal rights parties by focusing more broadly on systemic environmental transformation, climate policy, and sustainability rather than primarily on animal welfare or animal rights."
 ],
 [
  "Islamism",
  "#8A9099",
  "Islamist parties are political movements whose primary political concern is the promotion of law and social order informed by Islamic values and religious principles. They tend to advocate socially conservative policies, stronger roles for religion in public life, support for heteronormative family structures, and, in some cases, the greater incorporation of Islamic legal or moral frameworks into governance, often pairing this with economic conservatism or welfare-oriented communitarianism. They distinguish themselves from mainstream conservative and centre-right parties by placing religious doctrine and faith-based morality at the centre of policymaking, while distinguishing themselves from secular nationalist or right-wing parties by prioritizing religious identity and moral order over ethnic nationalism or purely state-centred conceptions of national identity."
 ],
 [
  "Left-wing",
  "#990000",
  "Left-wing and democratic socialist parties are political movements whose primary political concern is the overcoming or fundamental transformation of capitalism through liberal-democratic and parliamentary means in pursuit of greater social and economic equality. They tend to advocate progressive taxation, welfare expansion, workers’ rights, environmental sustainability, anti-discrimination policies, democratic control over economic decision-making, and stronger public intervention in the economy, often combining social progressivism with critiques of inequality and corporate power. They distinguish themselves from centre-left and social democratic parties by viewing capitalism as a system that should ultimately be transcended rather than merely regulated or reformed, while distinguishing themselves from communist and anti-capitalist parties by accepting pluralist liberal democracy and seeking systemic change through electoral, parliamentary, and democratic institutions rather than rejecting the liberal democratic state or embracing revolutionary politics."
 ],
 [
  "Liberalism",
  "#FFD700",
  "Liberal parties are political movements whose primary political concern is the protection of individual liberty, political pluralism, and constitutional democracy within a capitalist economic framework. They tend to advocate civil liberties, rule of law, market-oriented economies, international cooperation, European integration, and institutional reform, often combining economic liberalism with socially progressive or moderate positions on cultural issues and a broad skepticism toward state intervention in both the economy and individuals’ private lives. They distinguish themselves from centre-right and conservative parties by placing greater emphasis on individual freedoms, social liberalism, institutional reform, and internationalism over tradition, authority, or social conservatism, while distinguishing themselves from centre-left and social democratic parties by placing greater trust in markets, entrepreneurship, fiscal moderation, and individual choice, alongside a broader rejection of state interventionism in the economy and social private life."
 ],
 [
  "Libertarianism",
  "#F2C300",
  "Libertarian and classical liberal parties are political movements whose primary political concern is the maximization of individual liberty through a broad rejection of state interventionism in both the economy and private life. They tend to advocate a minimal state primarily limited to upholding laws, policing, national defence, secure borders, and the protection of property rights and free markets, while favouring privatization or market provision of services such as healthcare, education, and welfare. They generally support low taxation, deregulation, strong civil liberties, individual responsibility, and extensive personal freedoms, often combining economically laissez-faire policies with socially liberal or anti-authoritarian positions. They distinguish themselves from mainstream liberal and centre-right parties by advocating a far smaller role for the state and stronger free-market economics, while distinguishing themselves from conservative parties by typically rejecting moral paternalism and state involvement in regulating private or social behaviour."
 ],
 [
  "Monarchism",
  "#8A9099",
  "Monarchist and royalist parties are political movements whose primary political concern is the preservation or restoration of monarchy as a source of national unity, historical continuity, and political legitimacy. They tend to advocate traditional values, patriotism, institutional continuity, and stronger national identity, often viewing constitutional or symbolic monarchy as a stabilizing force above partisan politics. They distinguish themselves from mainstream conservative and centre-right parties by placing the monarchy or dynastic legitimacy at the centre of their political identity and constitutional vision, while distinguishing themselves from far-right parties by typically emphasizing historical continuity and constitutional order over ethnonationalism."
 ],
 [
  "National-conservatism",
  "#0000FF",
  "National-conservative parties are political movements whose primary political concern is the protection of national sovereignty, cultural continuity, social order, and traditional values within the framework of representative democracy. They tend to advocate stronger borders, law and order, national identity, social conservatism, market-oriented or mixed economies, and skepticism toward supranational governance, often emphasizing patriotism, gradual change, and institutional stability, while many national-conservative parties combine this with Atlanticism, support for NATO, and strong transatlantic partnerships. They distinguish themselves from centre-right and liberal parties by placing greater emphasis on national identity, cultural conservatism, sovereignty, and skepticism toward immigration or supranational institutions, while distinguishing themselves from far-right parties by generally accepting pluralist liberal democracy, multiparty parliamentarism, constitutional constraints, and transatlantic cooperation rather than embracing anti-system politics, ethnonationalism, or hostility toward Western alliances."
 ],
 [
  "Pirate politics",
  "#9c36b8",
  "Pirate parties are political movements whose primary political concern is the protection of digital rights, civil liberties, transparency, and participatory democracy in the information age. They tend to advocate internet freedom, data privacy, government transparency, open-source technologies, copyright reform, democratic innovation, and strong protections against state or corporate surveillance, often pairing these positions with socially liberal and pro-democratic values. They distinguish themselves from liberal and centrist parties by placing digital rights, democratic participation, and transparency at the centre of policymaking rather than treating them as secondary issues, while distinguishing themselves from broader progressive or left-wing parties by focusing less on traditional economic redistribution and more on civil liberties, decentralization, technological openness, and democratic reform."
 ],
 [
  "Right-wing",
  "#000000",
  "Right-wing parties are political movements whose primary political concern is the protection of national sovereignty, traditional social order, and the perceived interests of “ordinary people” against political elites, globalization, immigration, or supranational institutions. They tend to advocate restrictive immigration policies, stronger borders, law and order, welfare chauvinism or economic protectionism, skepticism toward supranational governance, and culturally conservative positions, often combining nationalism with anti-establishment or populist rhetoric and a more skeptical stance toward transatlantic institutions or alliances. They distinguish themselves from national-conservative parties by placing greater emphasis on populist anti-elite politics, political personalization, and skepticism toward transatlanticism or Western institutional alignment, while distinguishing themselves from far-right parties by generally avoiding explicit ethnonationalism and accepting multiparty parliamentary democracy, even if they challenge liberal norms, minority protections, or judicial constraints."
 ]
];
// ---------- ideology legend ----------
let legendAll = false;
const ideoKey = v => String(v || "").toLowerCase().replace(/-/g, " ").replace(/^libertarian$/, "libertarianism").trim();
function renderLegend() {
  const ideosOf = r => String(r[C.ideo] || "").split(/[,;]/).map(ideoKey).filter(Boolean);
  const count = n => VIEW.filter(r => ideosOf(r).includes(ideoKey(n))).length;
  const items = IDEOLOGY_DEFS.map(([n, c, t]) => ({ n, c, t, k: count(n) }));
  const present = items.filter(i => i.k > 0), shown = legendAll ? items : present;
  const known = new Set(IDEOLOGY_DEFS.map(([n]) => ideoKey(n))), undef = {};
  VIEW.forEach(r => String(r[C.ideo] || "").split(/[,;]/).map(x => x.trim()).filter(Boolean).forEach(x => { if (!known.has(ideoKey(x))) undef[x] = (undef[x] || 0) + 1; }));
  const undefTxt = Object.entries(undef).sort((a, b) => b[1] - a[1]).map(([n, k]) => `${esc(n)} (${fmt(k)})`).join(", ");
  $("#lg-note").textContent = legendAll ? "All ideologies · counts are for the parties in view" : "Ideologies of the parties in view";
  $("#legend-ideo").innerHTML = shown.map(({ n, c, t, k }) => `<div class="lg" style="background:${c}12">
      <div class="t"><span class="dot" style="background:${c}"></span><h3>${esc(n)}</h3>${k ? `<span class="count">${fmt(k)} ${k === 1 ? "party" : "parties"}</span>` : ""}</div>
      <p>${esc(t)}</p></div>`).join("") || '<p class="note">No parties in view.</p>';
  $("#lg-undef").textContent = undefTxt ? `Also used, without a definition: ${undefTxt.replace(/&amp;/g, "&")}.` : "";
  const hidden = items.length - present.length, btn = $("#lg-toggle");
  btn.style.display = hidden || legendAll ? "block" : "none";
  btn.textContent = legendAll ? "Show only ideologies in view" : `Show all ${items.length} ideologies`;
  btn.setAttribute("aria-expanded", legendAll);
  btn.onclick = () => { legendAll = !legendAll; renderLegend(); postHeight(); };
}

// ---------- table ----------
const COLS = [
  ["country", "Country", r => r[C.country]],
  ["abbr", "Abbr.", r => r[C.abbr]],
  ["name", "Party", r => r[C.name]],
  ["ideo", "Ideology", r => r[C.ideo]],
  ["region", "Region", r => r._region],
  ["ep", "International federation", r => r._ep],
  ["year", "Since", r => r._year ?? ""],
  ["status", "Status", r => r._status],
];
function renderTable() {
  const get = COLS.find(c => c[0] === sort.key)[2];
  const rows = VIEW.slice().sort((a, b) => { const r = d3.ascending(get(a) || "￿", get(b) || "￿"); return sort.asc ? r : -r; });
  $("#tbl thead").innerHTML = "<tr>" + COLS.map(([k, l]) => `<th data-k="${k}" class="${sort.key === k ? "sorted" + (sort.asc ? " asc" : "") : ""}">${l}</th>`).join("") + "</tr>";
  $("#tbl thead").querySelectorAll("th").forEach(th => th.onclick = () => { const k = th.dataset.k; sort = { key: k, asc: sort.key === k ? !sort.asc : true }; renderTable(); });
  $("#tbl tbody").innerHTML = rows.slice(0, shown).map((r, i) => `<tr data-i="${ALL.indexOf(r)}">
    <td>${esc(r[C.country])}</td><td><b>${esc(r[C.abbr])}</b></td>
    <td>${esc(r[C.name])}<br><span class="native">${esc(trunc(r[C.native] || "", 48))}</span></td>
    <td>${esc(r[C.ideo])}</td><td>${esc(r._region)}</td>
    <td>${r._ep ? `<span class="pill"><i style="background:${colorOf(r._ep)}"></i>${esc(r._ep)}</span>` : ""}</td>
    <td class="num">${r._year ?? ""}</td><td><span class="status">${esc(r._status)}</span></td></tr>`).join("");
  $("#tbl tbody").querySelectorAll("tr").forEach(tr => tr.onclick = () => openDrawer(ALL[+tr.dataset.i]));
  $("#tbl-count").textContent = `${fmt(rows.length)} rows · showing ${fmt(Math.min(shown, rows.length))}. Click a row for full details.`;
  $("#more").style.display = rows.length > shown ? "block" : "none";
}

// ---------- drawer ----------
function openDrawer(r) {
  const val = v => (v ? esc(v) : '<span style="color:var(--muted)">—</span>');
  $("#drawer-body").innerHTML = `
    <h3>${esc(r[C.name])} ${r[C.abbr] ? `<span style="color:var(--muted);font-weight:400">(${esc(r[C.abbr])})</span>` : ""}</h3>
    <div class="logo-box" id="drawer-logo" hidden></div>
    <div class="native">${esc(r[C.native])} · ${esc(r[C.country])}</div>
    ${SECTIONS.map(([t, ks]) => {
      // "Unaffiliated" is shown as its own category, so a start date (e.g. "EP Group Start 2018") always has a group next to it.
      // Affiliation sections list fields in threes: group/affiliation, start, end.
      const unaff = v => /^unaffiliated$/i.test(String(v || "").trim());
      const has = k => r[k] && (!isNone(r[k]) || unaff(r[k]));
      let items, show = k => r[k];
      if (t === "Identity" || t === "Profile" || t === "Dates") items = t === "Dates" ? ks.filter(has) : ks;
      else {
        items = []; const filled = new Set();
        for (let i = 0; i < ks.length; i += 3) {
          const trio = ks.slice(i, i + 3);
          if (!trio.some(has)) continue;
          items.push(...trio.filter((k, j) => j === 0 || has(k)));
          if (!has(trio[0]) || unaff(r[trio[0]])) filled.add(trio[0]);
        }
        show = k => filled.has(k) ? "Unaffiliated" : r[k];
      }
      if (!items.length) return "";
      return `<h4>${t}</h4><dl>${items.map(k => `<dt>${esc(k)}</dt><dd>${val(show(k))}</dd>`).join("")}</dl>`;
    }).join("")}`;
  $("#drawer").classList.add("open"); $("#drawer").setAttribute("aria-hidden", "false");
  placeDrawer(); postHeight();
  const token = (openDrawer.token = (openDrawer.token || 0) + 1);
  findLogo(r).then(src => {
    const box = $("#drawer-logo");
    if (!src || !box || openDrawer.token !== token) return;
    box.innerHTML = `<img src="${esc(src)}" alt="Logo of ${esc(r[C.name])}" onerror="this.parentNode.hidden=true">`;
    box.hidden = false; postHeight();
  });
}

// ---------- party logos (same rules as the country pages) ----------
// 1. A "Logo" column in the database (a Wikipedia/Commons file link, an image URL, a Wikidata Q-ID, or "none").
// 2. Otherwise the party's English Wikipedia article (English, then native name) → Wikidata logo (P154),
//    accepted only if Wikidata says it is a political party in that country.
const LOGO_CACHE = new Map();
const wikiJSON = url => fetch(url).then(res => { if (!res.ok) throw new Error("HTTP " + res.status); return res.json(); });
const claims = (e, p) => (((e && e.claims) || {})[p] || []).filter(c => c.rank !== "deprecated").map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value).filter(Boolean);
const filePath = (host, file) => `https://${host}/wiki/Special:FilePath/${encodeURIComponent(String(file).replace(/ /g, "_"))}?width=360`;
function logoSpec(v) {
  v = clean(v);
  if (!v) return null;
  if (/^(none|no|-|–|hide|hidden)$/i.test(v)) return { hide: true };
  if (/^Q\d+$/i.test(v)) return { qid: v.toUpperCase() };
  const wiki = v.match(/^https?:\/\/([\w.-]+\.(?:wikipedia|wikimedia)\.org)\/wiki\/(?:[^#]*#\/media\/)?[^:/#]+:([^?#]+\.(?:svg|png|jpe?g|gif|webp|tiff?))(?:[?#].*)?$/i);
  if (wiki) return { src: filePath(wiki[1].replace(".m.", "."), decodeURIComponent(wiki[2])) };
  const bare = v.match(/^(?:File:)?(.+\.(?:svg|png|jpe?g|gif|webp))$/i);
  if (bare && !/^https?:/i.test(v)) return { src: filePath("commons.wikimedia.org", bare[1]) };
  if (/^https?:\/\//i.test(v)) return { src: v };
  return null;
}
async function titleToQid(title) {
  const j = await wikiJSON("https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=pageprops&ppprop=wikibase_item|disambiguation&titles=" + encodeURIComponent(title));
  const pg = Object.values((j.query || {}).pages || {})[0] || {}, pp = pg.pageprops || {};
  return pp.wikibase_item && !("disambiguation" in pp) ? pp.wikibase_item : null;
}
async function entities(qids) {
  const j = await wikiJSON("https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&props=claims&ids=" + qids.join("|"));
  return j.entities || {};
}
function findLogo(r) {
  const key = r[C.verId] || r[C.id] || r[C.name];
  if (!LOGO_CACHE.has(key)) LOGO_CACHE.set(key, (async () => {
    const sp = logoSpec(r.Logo || r["Logo URL"] || r["Logo Override"]);
    if (sp && sp.hide) return null;
    if (sp && sp.src) return sp.src;
    try {
      const forced = (sp && sp.qid) || (clean(r["Wikidata ID"]).match(/Q\d+/) || [""])[0];
      const [qCountry, qEn, qNat] = await Promise.all([r[C.country], r[C.name], r[C.native]].map(t => (t ? titleToQid(t).catch(() => null) : null)));
      const qids = [...new Set([forced, qEn, qNat].filter(Boolean))];
      if (!qids.length) return null;
      const ents = await entities(qids);
      for (const q of qids) {
        const e = ents[q]; if (!e) continue;
        if (q !== forced) {
          const inCountry = qCountry && claims(e, "P17").some(v => v.id === qCountry);
          const isParty = claims(e, "P31").some(v => v.id === "Q7278") || claims(e, "P1142").length > 0;
          if (!inCountry || !isParty) continue;
        }
        const file = claims(e, "P154")[0] || claims(e, "P8972")[0];
        if (file) return filePath("commons.wikimedia.org", file);
      }
    } catch (e) { /* no logo */ }
    return null;
  })());
  return LOGO_CACHE.get(key);
}
const closeDrawer = () => { $("#drawer").classList.remove("open"); $("#drawer").setAttribute("aria-hidden", "true"); postHeight(); };

// ---------- embedding (WordPress iframe) ----------
// Inside an iframe the page has no scrollbar of its own: it reports its height to the parent page (same message
// as the other Europe Elects embeds), and the detail panel opens next to where the reader clicked.
const EMBEDDED = window.self !== window.top;
if (EMBEDDED) document.documentElement.classList.add("embedded");
let lastY = 0;
addEventListener("pointerdown", e => { lastY = e.pageY; }, true);
function postHeight() {
  if (!EMBEDDED) return;
  const d = $("#drawer"), drawerBottom = d.classList.contains("open") ? d.offsetTop + d.offsetHeight + 16 : 0;
  const h = Math.max(document.body.scrollHeight, drawerBottom);
  parent.postMessage({ "datawrapper-height": { "ae-atlas": h } }, "*");
}
function placeDrawer() {
  if (!EMBEDDED) return;
  const d = $("#drawer");
  d.style.top = Math.max(0, Math.min(lastY - 120, document.body.scrollHeight - d.offsetHeight)) + "px";
}

function renderAll() { renderKPIs(); renderMap(); renderEPTotal(); renderSpectrum(); renderTable(); renderLegend(); setTimeout(postHeight, 50); }

// ---------- boot ----------
async function boot() {
  let data;
  try { data = await load(); } catch (e) { $("#data-stamp").textContent = "could not load data"; return; }
  // Latest version of each entity = highest Europe Elects Entity Version per Entity ID (filter "latest version only").
  const rows = data.rows.map(normalise), maxVer = new Map();
  rows.forEach(r => { const id = r[C.id] || r[C.name]; maxVer.set(id, Math.max(maxVer.get(id) || 0, r._ver)); });
  rows.forEach(r => { r._latest = r._ver === maxVer.get(r[C.id] || r[C.name]); });
  ALL = rows;
  const fromSample = data.url.includes("sample");
  $("#data-stamp").textContent = `${fmt(ALL.filter(r => r._latest).length)} parties${fromSample ? " (sample data)" : ""}${data.stamp ? " · updated " + new Date(data.stamp).toLocaleDateString() : ""}`;

  const countries = [...d3.rollup(ALL, v => v[0][C.country], r => r[C.iso])].filter(([k]) => k).sort((a, b) => String(a[1]).localeCompare(String(b[1]), "en", { sensitivity: "base" })); // "Åland" sorts as "Aland"
  fillSelect($("#f-country"), countries.map(([iso, n]) => [iso, n]), "All countries");
  // "realigned" rows are earlier versions of a party that changed affiliation: never offered as a status.
  const statuses = d3.rollups(ALL.filter(r => r._status !== "realigned" && r._latest), v => v.length, r => r._status).sort((a, b) => b[1] - a[1]);
  $("#f-status").innerHTML = `<option value="">All statuses</option>` + statuses.map(([s, n]) => `<option value="${esc(s)}">${esc(s)} (${n})</option>`).join("");
  if (!statuses.some(s => s[0] === "active")) state.status = "";
  $("#f-status").value = state.status;
  const eps = [...new Set(ALL.map(r => r._ep).filter(Boolean))].sort((a, b) => d3.ascending(a, b));
  // Federations not in the FED list get colours of their own.
  eps.filter(e => !FED_COLOR[e]).forEach((e, i) => (FED_COLOR[e] = OTHER_FED[i % OTHER_FED.length]));
  fillSelect($("#f-ep"), eps.map(e => [e, e]), "All international federations");
  const regs = REGIONS.filter(g => ALL.some(r => r._region === g));
  fillSelect($("#f-region"), regs.map(g => [g, g]), "All regions");
  const ideos = [...new Set(ALL.map(r => r[C.ideo]).filter(Boolean))].sort();
  fillSelect($("#f-ideo"), ideos.map(e => [e, e]), "All ideologies");

  // URL state (shareable links)
  const p = new URLSearchParams(location.hash.slice(1));
  for (const k of ["q", "country", "status", "ep", "ideo", "region"]) if (p.has(k)) state[k] = p.get(k);
  $("#q").value = state.q; $("#f-country").value = state.country; $("#f-status").value = state.status; $("#f-ep").value = state.ep; $("#f-ideo").value = state.ideo; $("#f-region").value = state.region;

  const on = (sel, k, ev = "change") => $(sel).addEventListener(ev, e => { state[k] = e.target.value; apply(); });
  on("#q", "q", "input"); on("#f-country", "country"); on("#f-status", "status"); on("#f-ep", "ep"); on("#f-ideo", "ideo"); on("#f-region", "region");
  $("#f-latest").onchange = e => { state.latest = e.target.checked; apply(); };
  $("#reset").onclick = () => { state = { q: "", country: "", status: statuses.some(s => s[0] === "active") ? "active" : "", ep: "", ideo: "", region: "", lean: false, latest: true };
    $("#q").value = ""; $("#f-latest").checked = true; ["#f-country", "#f-ep", "#f-ideo", "#f-region"].forEach(s => $(s).value = ""); $("#f-status").value = state.status; apply(); };
  $("#more").onclick = () => { shown += 200; renderTable(); };
  $("#drawer-close").onclick = closeDrawer;
  addEventListener("keydown", e => e.key === "Escape" && closeDrawer());
  let t; addEventListener("resize", () => { clearTimeout(t); t = setTimeout(renderAll, 150); });
  apply();
}
boot();
if (window.ResizeObserver) new ResizeObserver(() => postHeight()).observe(document.body);
})();
