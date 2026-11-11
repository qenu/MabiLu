"use strict";
/* Reads series.json (one request) and draws the tables and charts.
   It never writes data and never calls Nexon.
   Every number comes from the snapshots as they are: no daily-max rule.
   series.json has, per member, the 3 powers and the total rank for every snapshot.
   "綜合" (total) is the sum of the 3 powers (the same as the game's total); only it has a rank. */

const BASE = [
  {id: "combatpower", label: "戰鬥力"},
  {id: "livingpower", label: "生活"},
  {id: "attractiveness", label: "魅力"},
];
const TYPES = [{id: "total", label: "綜合"}].concat(BASE);
const WINS = [
  {id: "1d", label: "1 日", days: 1},
  {id: "3d", label: "3 日", days: 3},
  {id: "14d", label: "14 日", days: 14},
  {id: "all", label: "全期間"},
];
const RANGES = [   // how much history the growth chart shows, counted back from the newest snapshot
  {id: "3d", label: "3 日", days: 3},
  {id: "14d", label: "14 日", days: 14},
  {id: "30d", label: "30 日", days: 30},
  {id: "all", label: "全部"},
];
const MODES = [
  {id: "value", label: "數值"},
  {id: "pct", label: "成長 %"},
  {id: "move", label: "位移", title: "累計位移：每筆快照之間變化量的絕對值，逐次加總，不分漲跌"},
];
const DAY = 86400000;
const TOL = 6 * 3600e3;   // a window starts at the snapshot nearest to (newest - window), if one is within 6 hours of that time

const state = {metric: TYPES[0].id, sort: {key: "value", dir: -1}, range: "3d", mode: "value", q: ""};
let snap = {times: [], members: {}}, members = [], allClasses = [], snapCount = 0, isDemo = false, updatedAt = "";
const DEMO = new URLSearchParams(location.search).has("demo"); // ?demo loads demo/series.json

/* Restore metric/win/range/mode/q from the URL so a link or a reload reopens the same view.
   Unknown or invalid values fall back to the defaults above instead of erroring. */
(() => {
  const p = new URLSearchParams(location.search);
  const pick = (list, key) => { const v = p.get(key); return list.some((x) => x.id === v) ? v : null; };
  state.metric = pick(TYPES, "metric") || state.metric;
  state.range = pick(RANGES, "range") || state.range;
  state.mode = pick(MODES, "mode") || state.mode;
  if (p.has("q")) state.q = p.get("q");
})();
/* Write the view back to the URL (replace, not push: controls aren't a navigation history). */
function syncUrl() {
  const p = new URLSearchParams();
  if (DEMO) p.set("demo", "1");
  if (state.metric !== TYPES[0].id) p.set("metric", state.metric);
  if (state.range !== "3d") p.set("range", state.range);
  if (state.mode !== "value") p.set("mode", state.mode);
  if (state.q) p.set("q", state.q);
  const qs = p.toString();
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
}

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const fmt = (n) => n == null ? "–" : Number(n).toLocaleString("en-US", {maximumFractionDigits: 0});
const fmtDelta = (n) => n == null ? "–" : (n > 0 ? "+" : "") + fmt(n);
const dcls = (d) => d > 0 ? "up" : d < 0 ? "down" : "mut";
const mdDay = (day) => parseInt(day.slice(5, 7), 10) + "/" + parseInt(day.slice(8, 10), 10);
const label = (id) => TYPES.find((t) => t.id === id).label;
const tpeDay = (t) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);   // t in ms -> the Taipei date
const hhmm = (t) => mdDay(tpeDay(t)) + " " + new Date(t + 8 * 3600e3).toISOString().slice(11, 16);

/* ---------- data ---------- */
async function load() {
  const url = DEMO ? "demo/series.json" : "series.json";
  // Give up after 15 s so a stalled connection ends in the retry message instead of "載入中…" forever.
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
  let r;
  try { r = await fetch(url, {cache: "no-store", signal: ctl.signal}); } finally { clearTimeout(timer); }
  if (!r.ok) { const e = new Error(url + " HTTP " + r.status); e.status = r.status; throw e; }
  const j = await r.json();
  isDemo = !!j.demo;
  snapCount = j.snapshot_count || 0;
  updatedAt = j.updated_at || "";
  snap = {times: (j.times || []).map((s) => s * 1000), members: j.members || {}};
  // Only members with a value in the newest snapshot are shown. A member who left, renamed or was not found has no data now, so we leave them out everywhere. Their old snapshots stay in the files.
  allClasses = j.classes || [];             // every class in the game (no 見習), written by the collector
  members = Object.keys(snap.members).filter((m) => { const s = snapSeries(m, "total"); return s.length && s[s.length - 1].c; });
}
/* One point per snapshot: {t, c: {value, rank, class}} or c = null when the member has no value there.
   The total is the sum of the 3 powers. The rank (total only) is the total rank. */
function snapSeries(m, type = state.metric) {
  const s = snap.members[m];
  if (!s) return [];
  return snap.times.map((t, i) => {
    let v;
    if (type === "total") {
      const a = s.combatpower[i], b = s.livingpower[i], c = s.attractiveness[i];
      v = a == null || b == null || c == null ? null : a + b + c;
    } else v = s[type][i];
    return {t, c: v == null ? null : {value: v, rank: type === "total" && s.rank ? s.rank[i] : null, class: s.class}};
  });
}
function snapTicks(t0, t1) {   // the first point, then each Taipei midnight (thinned to about 5)
  const mids = [];
  for (let t = Date.parse(tpeDay(t0) + "T00:00:00+08:00") + DAY; t <= t1; t += DAY) mids.push(t);
  const kept = mids.filter((_, i) => i % (Math.ceil(mids.length / 5) || 1) === 0);
  return kept.length && (kept[0] - t0) / (t1 - t0) < 0.08 ? kept : [t0].concat(kept);   // drop the first label if a midnight is right next to it
}
const memberClass = (m) => snap.members[m] ? snap.members[m].class : "?";

/* The start of a change window. pts = the member's points that have a value, oldest first; the last one is "now".
   The start is the point nearest to (now - window). If none is within TOL, there is no start (the cell shows "–").
   "全期間" starts at the first point. */
function refPoint(pts, win) {
  if (pts.length < 2) return null;
  if (win === "all") return pts[0];
  const target = pts[pts.length - 1].t - WINS.find((w) => w.id === win).days * DAY;
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) if (!best || Math.abs(pts[i].t - target) < Math.abs(best.t - target)) best = pts[i];
  return best && Math.abs(best.t - target) <= TOL ? best : null;
}
/* The change of a member in a window, from the newest snapshot back to the start. A member who is not in the newest snapshot has none. */
function delta(ser, win) {
  const cur = ser[ser.length - 1];
  if (!cur || !cur.c) return null;
  const pts = ser.filter((p) => p.c), ref = refPoint(pts, win);
  return ref ? cur.c.value - ref.c.value : null;
}

/* ---------- hover details ---------- */
const tipEl = document.createElement("div");
tipEl.id = "tip";
tipEl.setAttribute("role", "tooltip");   // focusable targets point at it with aria-describedby, so screen readers read the details too
document.body.appendChild(tipEl);
function showTip(html, ev) {
  tipEl.innerHTML = html;
  tipEl.style.display = "block";
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + w > innerWidth - 8) x = ev.clientX - w - 14;
  if (y + h > innerHeight - 8) y = ev.clientY - h - 14;
  tipEl.style.left = Math.max(8, x) + "px";
  tipEl.style.top = Math.max(8, y) + "px";
}
const hideTip = () => { tipEl.style.display = "none"; };
/* Keyboard/touch equivalent of showTip: same panel, positioned from the focused element's own
   box instead of a mouse position (focus and tap have no clientX/Y to anchor on). */
function showTipFor(html, el) {
  const r = el.getBoundingClientRect();
  showTip(html, {clientX: r.left, clientY: r.bottom + 6});
}
/* The snapshot-by-snapshot moves of one member in a window: what went up, what went down.
   It uses the same start as the table cell, so up + down is exactly the number in the cell. */
function moves(m, win) {
  const ser = snapSeries(m), cur = ser[ser.length - 1];
  if (!cur || !cur.c) return null;
  const pts = ser.filter((p) => p.c), ref = refPoint(pts, win);
  if (!ref) return null;
  const seg = pts.slice(pts.indexOf(ref));
  let up = 0, down = 0, changes = 0;
  for (let i = 1; i < seg.length; i++) {
    const d = seg[i].c.value - seg[i - 1].c.value;
    if (d > 0) up += d; else if (d < 0) down += d;
    if (d) changes++;
  }
  return {from: seg[0].t, to: cur.t, up, down, net: up + down, changes, count: seg.length};
}
function winTip(m, win) {          // the table's change cells
  const w = WINS.find((x) => x.id === win), mv = moves(m, win);
  const head = '<div class="th">' + esc(m) + " · " + label(state.metric) + " · " + w.label + "</div>";
  if (!mv) return head + '<div class="tm">沒有足夠的資料</div>';
  return head + (mv.changes
    ? '<div class="tr">' + (mv.up ? '<span class="up">' + fmtDelta(mv.up) + "</span>" : "") +
      (mv.down ? '<span class="down">' + fmtDelta(mv.down) + "</span>" : "") + "<span>淨 " + fmtDelta(mv.net) + "</span></div>"
    : '<div class="tr mut">期間內沒有變動</div>') +
    '<div class="tm">共 ' + mv.count + " 筆，" + mv.changes + " 次變動<br>" + hhmm(mv.from) + " → " + hhmm(mv.to) + "</div>";
}
function latestPower(m, id) {
  const s = snap.members[m];
  if (!s) return null;
  for (let i = s[id].length - 1; i >= 0; i--) if (s[id][i] != null) return s[id][i];
  return null;
}
function memberTip(m) {            // the names at the end of the chart lines
  const ser = snapSeries(m), tot = snapSeries(m, "total"), tc = tot[tot.length - 1].c;
  const p = BASE.map((b) => latestPower(m, b.id)), total = p.some((v) => v == null) ? null : p[0] + p[1] + p[2];
  const mv1 = moves(m, "1d");
  let h = '<div class="th">' + esc(m) + " · " + esc(memberClass(m)) + "</div>" +
    '<div class="tr"><span>綜合 ' + fmt(total) + "</span>" + (tc && tc.rank != null ? '<span class="mut">#' + fmt(tc.rank) + "</span>" : "") + "</div>" +
    '<div class="tm">' + BASE.map((b, i) => b.label + " " + fmt(p[i])).join(" · ") + "</div>" +
    '<div class="tm" style="margin-top:4px">' + label(state.metric) + "：" +
    WINS.map((w) => w.label + ' <span class="' + dcls(delta(ser, w.id)) + '">' + fmtDelta(delta(ser, w.id)) + "</span>").join(" · ") + "</div>";
  if (mv1 && mv1.changes) h += '<div class="tm">1 日變化 <span class="up">' + (mv1.up ? fmtDelta(mv1.up) : "") + '</span> <span class="down">' + (mv1.down ? fmtDelta(mv1.down) : "") + "</span></div>";
  return h;
}
let hlId = null;
function highlight(i) {            // dim every line except the one under the pointer
  const svg = $("chart").querySelector("svg");
  if (!svg || hlId === i) return;
  svg.querySelectorAll(".on").forEach((e) => e.classList.remove("on"));
  hlId = i;
  svg.classList.toggle("hl", i != null);
  if (i != null) svg.querySelectorAll('[data-i="' + i + '"]').forEach((e) => e.classList.add("on"));
}

/* ---------- keyboard: one tab stop per region ---------- */
/* The roster's change cells and the chart's names are each ONE tab stop; the arrow keys move inside.
   (84 cells + 29 names used to sit between the table and the chart controls.) In the table, left/right
   move along a row and up/down along a column; in the chart, up/down (or left/right) step through names. */
function rove(root, sel) {
  const items = [...root.querySelectorAll(sel)];
  items.forEach((el, i) => el.setAttribute("tabindex", i ? "-1" : "0"));
}
function moveFocus(from, to) {
  if (!to) return;
  from.setAttribute("tabindex", "-1");
  to.setAttribute("tabindex", "0");
  to.focus();
}
document.addEventListener("keydown", (ev) => {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(ev.key)) return;
  const cell = ev.target.closest && ev.target.closest("#roster td[data-w]");
  const hit = ev.target.closest && ev.target.closest("#chart .hit");
  if (cell) {
    const row = cell.parentElement, col = cell.cellIndex;
    let to = null;
    if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
      const cells = [...row.querySelectorAll("td[data-w]")], i = cells.indexOf(cell);
      to = cells[i + (ev.key === "ArrowRight" ? 1 : -1)];
    } else if (ev.key === "Home" || ev.key === "End") {
      const cells = [...row.querySelectorAll("td[data-w]")];
      to = ev.key === "Home" ? cells[0] : cells[cells.length - 1];
    } else {
      for (let r = ev.key === "ArrowDown" ? row.nextElementSibling : row.previousElementSibling; r && !to;
        r = ev.key === "ArrowDown" ? r.nextElementSibling : r.previousElementSibling) {
        const c = r.cells[col];
        if (c && c.hasAttribute("data-w")) to = c;
      }
    }
    if (to) { ev.preventDefault(); moveFocus(cell, to); }
  } else if (hit) {
    const hits = [...$("chart").querySelectorAll(".hit")], i = hits.indexOf(hit);
    const to = ev.key === "Home" ? hits[0] : ev.key === "End" ? hits[hits.length - 1]
      : hits[i + (ev.key === "ArrowDown" || ev.key === "ArrowRight" ? 1 : -1)];
    if (to) { ev.preventDefault(); moveFocus(hit, to); }
  }
});

/* ---------- controls ---------- */
function seg(el, items, current, onPick) {
  el.innerHTML = items.map((i) => '<button data-v="' + i.id + '"' + (i.title ? ' title="' + esc(i.title) + '"' : "") + ' aria-pressed="' + (i.id === current) + '">' + i.label + "</button>").join("");
  for (const b of el.querySelectorAll("button")) b.onclick = () => onPick(b.dataset.v);
}

/* ---------- roster + guild stats ---------- */
function spark(ser) {
  const pts = ser.filter((p) => p.c);
  if (pts.length < 2) return '<span class="mut">–</span>';
  const w = 90, h = 24, pad = 2, t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const vs = pts.map((p) => p.c.value), lo = Math.min(...vs), hi = Math.max(...vs);
  const x = (t) => pad + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (w - 2 * pad);
  const y = (v) => hi === lo ? h / 2 : h - pad - ((v - lo) / (hi - lo)) * (h - 2 * pad);
  const d = curvePath(pts.map((p) => [x(p.t), y(p.c.value)]));
  return '<svg class="spark" aria-hidden="true" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h +
    '"><path d="' + d + '" fill="none" stroke="var(--acc)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function buildRows() {
  return members.map((m) => {
    const ser = snapSeries(m), last = ser[ser.length - 1].c;
    return {member: m, cls: memberClass(m), value: last ? last.value : null, rank: last ? last.rank : null,
      d1: delta(ser, "1d"), d3: delta(ser, "3d"), d14: delta(ser, "14d"), dall: delta(ser, "all"), ser};
  });
}
function renderStats(rows) {
  const v = rows.map((r) => r.value).filter((x) => x != null).sort((a, b) => a - b), n = v.length;
  const sum = v.reduce((a, b) => a + b, 0);
  const med = !n ? null : n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  const card = (k, val, sub) => '<div class="stat"><div class="k">' + k + '</div><div class="v">' + val + "</div>" +
    (sub ? '<div class="s">' + sub + "</div>" : "") + "</div>";
  const lb = label(state.metric);
  $("stats").innerHTML =
    card("成員數", fmt(n), n < rows.length ? "追蹤 " + rows.length + " 位，" + (rows.length - n) + " 位無資料" : "") +
    card(lb + "加總", fmt(n ? sum : null)) +
    card(lb + "平均", fmt(n ? sum / n : null)) +
    card(lb + "中位數", fmt(med));
}
function renderRoster() {
  const rows = buildRows();
  renderStats(rows);
  const showRank = rows.some((r) => r.rank != null);   // only the total has a rank; hide the empty column otherwise
  if (!showRank && state.sort.key === "rank") state.sort = {key: "value", dir: -1};
  const k = state.sort.key;
  rows.sort((a, b) => {
    const av = a[k], bv = b[k];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (typeof av === "string" ? av.localeCompare(bv) : av - bv) * state.sort.dir;
  });
  const cols = [["member", "成員"], ["cls", "職業"], ["value", label(state.metric)]].concat(showRank ? [["rank", "排名"]] : [])
    .concat([["d1", "1 日"], ["d3", "3 日"], ["d14", "14 日"], ["dall", "全期間"], ["", "趨勢"]]);
  const head = cols.map(([key, text]) => {
    if (!key) return "<th>" + text + "</th>";
    const active = key === k, dir = active ? (state.sort.dir > 0 ? "ascending" : "descending") : "none";
    return '<th aria-sort="' + dir + '"><button type="button" class="thbtn" data-k="' + key + '">' + text +
      (active ? (state.sort.dir > 0 ? " ▲" : " ▼") : "") + "</button></th>";
  }).join("");
  const d = (v, win, m) => '<td class="num ' + dcls(v) + '"' + (v == null ? "" : ' data-w="' + win + '" data-m="' + esc(m) + '" tabindex="-1" aria-describedby="tip"') + ">" + fmtDelta(v) + "</td>";
  const q = state.q.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.member.toLowerCase().includes(q) || r.cls.toLowerCase().includes(q)) : rows;
  const body = !shown.length ? '<tr><td class="empty" colspan="' + cols.length + '">沒有符合「' + esc(state.q.trim()) + '」的成員</td></tr>' : shown.map((r) => "<tr><td>" + esc(r.member) + "</td><td>" + esc(r.cls) + '</td><td class="num">' + fmt(r.value) +
    "</td>" + (showRank ? '<td class="num mut">' + (r.rank == null ? "–" : "#" + fmt(r.rank)) + "</td>" : "") + d(r.d1, "1d", r.member) + d(r.d3, "3d", r.member) + d(r.d14, "14d", r.member) + d(r.dall, "all", r.member) +
    "<td>" + spark(r.ser) + "</td></tr>").join("");
  $("roster").innerHTML = '<caption class="sr-only">成員總覽：變化欄可用方向鍵移動，聚焦時會說明期間內的漲跌</caption><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody>";
  rove($("roster"), "td[data-w]");
  for (const btn of $("roster").querySelectorAll(".thbtn")) {
    const key = btn.dataset.k;
    btn.onclick = () => {
      state.sort = {key, dir: state.sort.key === key ? -state.sort.dir : (key === "member" || key === "cls" ? 1 : -1)};
      renderRoster();
    };
  }
}

/* ---------- line chart (names sit at the right end of each line) ---------- */
/* A curve through a run of points [[x, y], ...] (x grows). It is monotone (Fritsch-Carlson): between two
   points it never goes above the higher one or below the lower one, and a flat part stays flat.
   So the curve shows no peak or dip that is not in the data. */
function curvePath(run) {
  const f = (p) => p[0].toFixed(1) + " " + p[1].toFixed(1);
  let d = "M" + f(run[0]);
  const n = run.length;
  if (n < 3 || run.some((p, i) => i && !(p[0] > run[i - 1][0]))) {         // 2 points, or x does not grow: straight lines
    for (let i = 1; i < n; i++) d += " L" + f(run[i]);
    return d;
  }
  const h = [], m = [];
  for (let i = 0; i < n - 1; i++) { h.push(run[i + 1][0] - run[i][0]); m.push((run[i + 1][1] - run[i][1]) / h[i]); }
  const t = run.map((_, i) => i === 0 ? m[0] : i === n - 1 ? m[n - 2] : (m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  for (let i = 0; i < n - 1; i++) {
    const c1 = [run[i][0] + h[i] / 3, run[i][1] + t[i] * h[i] / 3], c2 = [run[i + 1][0] - h[i] / 3, run[i + 1][1] - t[i + 1] * h[i] / 3];
    d += " C" + f(c1) + " " + f(c2) + " " + f(run[i + 1]);
  }
  return d;
}
/* Cumulative movement: starts at 0 on the member's first value and grows by |change| at every later snapshot.
   Up or down does not matter. A flat line means the member did nothing. */
function cumMove(ser) {
  let acc = 0, prev = null;
  return ser.map((p) => {
    if (!p.c) return null;
    if (prev != null) acc += Math.abs(p.c.value - prev);
    prev = p.c.value;
    return acc;
  });
}
/* Shorten a name to fit max px at the label size, ending in "…". */
function fitName(name, max) {
  if (textW(name) <= max) return name;
  const chars = [...name];
  while (chars.length > 1 && textW(chars.join("") + "…") > max) chars.pop();
  return chars.join("") + "…";
}
const textW = (s) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 12.5 : 7), 0);   // estimated label width at the 12px label size
function renderChart() {
  hlId = null; hideTip();
  const days = RANGES.find((r) => r.id === state.range).days;
  const start = days ? snap.times[snap.times.length - 1] - days * DAY : -Infinity;   // the chart starts here
  const lines = members.map((m, i) => {
    const ser = snapSeries(m).filter((p) => p.t >= start), base = ser.find((p) => p.c);   // growth % and movement start at the first point of the range
    const ys = state.mode === "move" ? cumMove(ser) : ser.map((p) => {
      if (!p.c) return null;
      if (state.mode === "value") return p.c.value;
      return base.c.value > 0 ? (p.c.value / base.c.value - 1) * 100 : null;
    });
    return {m, i, ser, ys};
  });
  const labeled = lines.filter((l) => l.ys.some((v) => v != null));
  if (!labeled.length) { $("chart").innerHTML = '<div class="empty">無資料</div>'; return; }
  const all = labeled.flatMap((l) => l.ys.filter((v) => v != null));
  // Draw at the container's real width so 1 SVG unit = 1 CSS px and chart text stays at the 12px label size
  // (a fixed 920-unit drawing scaled down to a phone shrank it to ~7px). Below 560px the card scrolls instead.
  // Label rows are the tap targets for member details: 24px on touch screens (WCAG 2.5.8), 15px with a mouse.
  const W = Math.max(560, $("chart").clientWidth || 920), L = 64, T = 12, B = 28, GAP = matchMedia("(pointer: coarse)").matches ? 24 : 15;
  const NAMEW = 198;   // longest label drawn; longer names are shortened with "…" (the full name stays in the button's label)
  const R = Math.min(220, Math.ceil(Math.max(...labeled.map((l) => Math.min(NAMEW, textW(l.m)))) + 22));
  const H = Math.max(280, T + B + labeled.length * GAP + 8);   // tall enough for every label
  let lo = Math.min(...all), hi = Math.max(...all);
  if (lo === hi) { lo -= 1; hi += 1; }
  const padY = (hi - lo) * 0.06; if (state.mode !== "move") lo -= padY; hi += padY;   // movement starts at 0 and cannot go below it
  const t0 = snap.times.find((t) => t >= start), t1 = snap.times[snap.times.length - 1];
  const x = (t) => t1 === t0 ? (L + W - R) / 2 : L + (t - t0) / (t1 - t0) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const yf = (v) => state.mode === "pct" ? v.toFixed(1) + "%" : fmt(v);
  let svg = '<svg class="big" viewBox="0 0 ' + W + " " + H + '" role="group" aria-labelledby="hChart">';
  // The value labels live in an HTML column pinned to the left edge (see .yaxis), so they stay in view when a
  // phone scrolls the chart sideways. The SVG is drawn 1 unit = 1 px, so their positions match the gridlines.
  let axis = '<div class="yaxis" aria-hidden="true" style="width:' + L + "px;height:" + H + 'px">';
  for (let k = 0; k <= 4; k++) {
    const v = lo + (hi - lo) * k / 4, yy = y(v);
    svg += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '"/>';
    axis += '<span style="top:' + yy.toFixed(1) + 'px">' + yf(v) + "</span>";
  }
  axis += "</div>";
  const ticks = snapTicks(t0, t1);
  const tickText = (t) => mdDay(tpeDay(t));
  ticks.forEach((t, k) => {
    const anchor = ticks.length > 1 && k === 0 ? "start" : ticks.length > 1 && k === ticks.length - 1 ? "end" : "middle";
    svg += '<text x="' + x(t).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + anchor + '" aria-hidden="true">' + tickText(t) + "</text>";
  });
  for (const l of lines) {
    if (!l.ys.some((v) => v != null)) continue;   // no value in this range: nothing to draw
    const c = l.i % 10;
    const runs = [];                       // a gap (no data) splits the line into runs
    l.ser.forEach((p, j) => {
      if (l.ys[j] == null) { runs.push([]); return; }
      if (!runs.length) runs.push([]);
      runs[runs.length - 1].push([x(p.t), y(l.ys[j])]);
    });
    const d = runs.filter((r) => r.length).map(curvePath).join(" ");
    svg += '<path class="ln l' + c + '" data-i="' + l.i + '" d="' + d + '"><title>' + esc(l.m) + "</title></path>";
    l.ser.forEach((p, k) => {            // a lone point has no line, so draw it as a dot
      if (l.ys[k] == null || (k > 0 && l.ys[k - 1] != null) || (k < l.ys.length - 1 && l.ys[k + 1] != null)) return;
      svg += '<circle class="f' + c + '" cx="' + x(p.t).toFixed(1) + '" cy="' + y(l.ys[k]).toFixed(1) + '" r="3"><title>' +
        esc(l.m + " · " + hhmm(p.t) + " · " + fmt(p.c.value)) + "</title></circle>";
    });
  }
  // End labels: sort by height, then push apart so no two labels overlap.
  const items = labeled.map((l) => {
    let j = l.ys.length - 1;
    while (l.ys[j] == null) j--;
    return {l, px: x(l.ser[j].t), py: y(l.ys[j]), ty: 0};
  }).sort((a, b) => a.py - b.py);
  let prev = -1e9;
  for (const it of items) { it.ty = Math.max(it.py, prev + GAP); prev = it.ty; }
  const bottom = H - B;
  if (prev > bottom) { let next = bottom; for (let i = items.length - 1; i >= 0; i--) { items[i].ty = Math.min(items[i].ty, next); next = items[i].ty - GAP; } }
  const xl = W - R + 8;
  for (const it of items) {
    const c = it.l.i % 10;
    if (Math.abs(it.ty - it.py) > 1.5 || it.px < W - R - 1)   // moved, or the line ended early (member left)
      svg += '<line class="lead l' + c + '" data-i="' + it.l.i + '" x1="' + (it.px + 4).toFixed(1) + '" y1="' + it.py.toFixed(1) + '" x2="' + (xl - 3) + '" y2="' + it.ty.toFixed(1) + '"/>';
    svg += '<rect class="hit" tabindex="-1" role="button" aria-describedby="tip" aria-label="' + esc(it.l.m) + '" data-i="' + it.l.i + '" data-m="' + esc(it.l.m) + '" x="' + (xl - 4) + '" y="' + (it.ty - GAP / 2).toFixed(1) +
      '" width="' + (R - 4) + '" height="' + GAP + '"/><text class="f' + c + '" x="' + xl + '" y="' + (it.ty + 4).toFixed(1) + '" aria-hidden="true">' + esc(fitName(it.l.m, NAMEW)) + "</text>";
  }
  $("chart").innerHTML = axis + svg + "</svg>";
  rove($("chart"), ".hit");
  // On a phone the chart is wider than its box; open it at the newest end, where the member names are.
  const box = $("chart").parentElement;
  if (box.scrollWidth > box.clientWidth) box.scrollLeft = box.scrollWidth;
}

/* ---------- class stats ---------- */
function renderFun() {
  const n = members.length;
  if (!n) { $("fun").innerHTML = '<div class="empty">尚無資料</div>'; $("classList").innerHTML = ""; return; }
  const byClass = {};
  for (const m of members) (byClass[memberClass(m)] = byClass[memberClass(m)] || []).push(m);
  const all = allClasses.length ? allClasses : Object.keys(byClass);
  const counts = Object.keys(byClass).map((c) => [c, byClass[c].length])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hant"));
  const absent = all.filter((c) => !byClass[c]);
  const used = all.filter((c) => byClass[c]).length;
  const card = (k, v, s) => '<div class="stat txt"><div class="k">' + k + '</div><div class="v">' + esc(v) + "</div>" +
    (s ? '<div class="s">' + esc(s) + "</div>" : "") + "</div>";
  const avg = Object.keys(byClass).map((c) => {
    const v = byClass[c].map((m) => { const s = snapSeries(m, "total"); return s[s.length - 1].c.value; });
    return [c, v.reduce((a, b) => a + b, 0) / v.length, v.length];
  });
  const pool = avg.filter((x) => x[2] >= 2);   // a class with 1 player says nothing about the class
  const best = (pool.length ? pool : avg).sort((a, b) => b[1] - a[1])[0];
  $("fun").innerHTML =
    card("職業多樣性", used + " / " + all.length, "公會擁有 " + Math.round(used / all.length * 100) + "% 的職業") +
    card("沒人玩的職業", absent.length + " 種", absent.length ? absent.join("、") : "每種職業都有人") +
    card("平均綜合最高的職業", best[0], "平均 " + fmt(best[1]) + "（" + best[2] + " 人，2 人以上才算）");
  /* The head count per class as a grid of people: 10 cells per row, one cell per member, so each class's
     area is exactly its head count (on phones the row is 4 cells and big classes clamp to the row).
     The most played class is solid accent; the others are tinted by head count. */
  const top = counts[0][1];
  const cells = counts.map(([c, k]) => {
    const tint = k === top ? "" : ";--tint:" + (9 + 40 * (top > 1 ? (k - 1) / (top - 1) : 0)).toFixed(1) + "%";
    return '<li class="' + (k === top ? "top" : "") + '" style="--n:' + Math.min(k, 10) + ";--nn:" + Math.min(k, 4) + tint + '"><span class="cn">' + esc(c) +
      '</span><span class="meta"><span class="num">' + k + ' 人</span><span class="num">' + Math.round(k / n * 100) + "%</span></span></li>";
  }).join("");
  $("classList").innerHTML = "<ol>" + cells + '</ol><p class="foot mut">每一格是一位成員 · 共 ' + n + " 人</p>";
}

/* ---------- page ---------- */
function render() {
  seg($("metrics"), TYPES, state.metric, (v) => { state.metric = v; render(); });
  seg($("modes"), MODES, state.mode, (v) => { state.mode = v; render(); });
  seg($("ranges"), RANGES, state.range, (v) => { state.range = v; render(); });
  $("hChart").textContent = label(state.metric) + (state.mode === "move" ? "累計位移" : "成長曲線");   // the two titles follow the selected metric
  renderRoster(); renderChart(); renderFun();
  syncUrl();
}
load().then(() => {
  if (!snap.times.length) { $("sub").textContent = "尚無資料"; $("roster").innerHTML = '<tbody><tr><td class="empty">尚無資料</td></tr></tbody>'; return; }
  $("sub").classList.toggle("demo", isDemo);
  $("sub").textContent = isDemo ? "【示範模擬資料】" : "";   // empty (and hidden) for real data
  const u = updatedAt;   // e.g. 2026-11-02T14:58:00+08:00 : show it as written, in the collector's time zone
  $("footUpdated").textContent = "更新於 " + (u ? u.slice(0, 10) + " " + u.slice(11, 16) + (u.length > 19 ? "<UTC" + u.slice(19) + ">" : "")
    : "") + " · 共 " + new Set(snap.times.map(tpeDay)).size + " 天、" + snapCount + " 筆";
  render();
}).catch((e) => {
  console.error(e);
  // Say which side failed: the server answered with an error, the request timed out, or there was no connection.
  const why = e.status ? "資料暫時無法取得（HTTP " + e.status + "）" : e.name === "AbortError" ? "載入逾時，連線可能太慢" : "無法載入資料，請檢查網路連線";
  $("sub").innerHTML = why + ' <button type="button" id="retry">重試</button>';
  $("retry").onclick = () => location.reload();
});

let lastW = 0;   // the chart is drawn at its container width, so redraw it when that width changes
let resizeQueued = false;   // a window drag fires many resize events: redraw at most once per frame
addEventListener("resize", () => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    const w = $("chart").clientWidth;
    if (snap.times.length && w !== lastW) { lastW = w; renderChart(); }
  });
});

const qBox = $("q");
qBox.value = state.q;
let composing = false;
const applySearch = () => { state.q = qBox.value; if (snap.times.length) { renderRoster(); syncUrl(); } };
qBox.addEventListener("compositionstart", () => { composing = true; });
qBox.addEventListener("compositionend", () => { composing = false; applySearch(); });
qBox.addEventListener("input", () => { if (!composing) applySearch(); });

$("roster").addEventListener("mousemove", (ev) => {
  const td = ev.target.closest("td[data-w]");
  if (td) showTip(winTip(td.dataset.m, td.dataset.w), ev); else hideTip();
});
$("roster").addEventListener("mouseleave", hideTip);
$("roster").addEventListener("focusin", (ev) => {
  const td = ev.target.closest("td[data-w]");
  if (td) showTipFor(winTip(td.dataset.m, td.dataset.w), td);
});
$("roster").addEventListener("focusout", (ev) => { if (ev.target.closest("td[data-w]")) hideTip(); });
$("chart").addEventListener("mousemove", (ev) => {
  const hit = ev.target.closest(".hit");
  if (hit) { highlight(hit.dataset.i); showTip(memberTip(hit.dataset.m), ev); } else { highlight(null); hideTip(); }
});
$("chart").addEventListener("mouseleave", () => { highlight(null); hideTip(); });
$("chart").addEventListener("focusin", (ev) => {
  const hit = ev.target.closest(".hit");
  if (hit) { highlight(hit.dataset.i); showTipFor(memberTip(hit.dataset.m), hit); }
});
$("chart").addEventListener("focusout", (ev) => { if (ev.target.closest(".hit")) { highlight(null); hideTip(); } });
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") hideTip(); });
