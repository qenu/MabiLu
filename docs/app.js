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
const MODES = [
  {id: "value", label: "數值"},
  {id: "pct", label: "成長 %"},
  {id: "move", label: "位移", title: "累計位移：每筆快照之間變化量的絕對值，逐次加總，不分漲跌"},
];
const DAY = 86400000;
const TOL = 6 * 3600e3;   // a window starts at the snapshot nearest to (newest - window), if one is within 6 hours of that time

const state = {metric: TYPES[0].id, sort: {key: "value", dir: -1}, win: "1d", mode: "value", q: ""};
let snap = {times: [], members: {}}, members = [], snapCount = 0, isDemo = false, updatedAt = "";
const DEMO = new URLSearchParams(location.search).has("demo"); // ?demo loads demo/series.json

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
  const r = await fetch(url, {cache: "no-store"});
  if (!r.ok) throw new Error(url + " HTTP " + r.status);
  const j = await r.json();
  isDemo = !!j.demo;
  snapCount = j.snapshot_count || 0;
  updatedAt = j.updated_at || "";
  snap = {times: (j.times || []).map((s) => s * 1000), members: j.members || {}};
  members = Object.keys(snap.members);      // the order the members first appeared: it also keeps the line colors steady
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
  return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h +
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
  $("stats").innerHTML =
    card("成員數", fmt(n), n < members.length ? "追蹤 " + members.length + " 位，" + (members.length - n) + " 位無資料" : "") +
    card("綜合加總", fmt(n ? sum : null)) +
    card("總和平均", fmt(n ? sum / n : null)) +
    card("總和中位數", fmt(med));
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
  const cols = [["member", "成員"], ["cls", "職業"], ["value", "最新"]].concat(showRank ? [["rank", "排名"]] : [])
    .concat([["d1", "1 日"], ["d3", "3 日"], ["d14", "14 日"], ["dall", "全期間"], ["", "趨勢"]]);
  const head = cols.map(([key, text]) => '<th data-k="' + key + '">' + text +
    (key && key === k ? (state.sort.dir > 0 ? " ▲" : " ▼") : "") + "</th>").join("");
  const d = (v, win, m) => '<td class="num ' + dcls(v) + '"' + (v == null ? "" : ' data-w="' + win + '" data-m="' + esc(m) + '"') + ">" + fmtDelta(v) + "</td>";
  const q = state.q.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.member.toLowerCase().includes(q) || r.cls.toLowerCase().includes(q)) : rows;
  const body = !shown.length ? '<tr><td class="empty" colspan="' + cols.length + '">沒有符合「' + esc(state.q.trim()) + '」的成員</td></tr>' : shown.map((r) => "<tr><td>" + esc(r.member) + "</td><td>" + esc(r.cls) + '</td><td class="num">' + fmt(r.value) +
    "</td>" + (showRank ? '<td class="num mut">' + (r.rank == null ? "–" : "#" + fmt(r.rank)) + "</td>" : "") + d(r.d1, "1d", r.member) + d(r.d3, "3d", r.member) + d(r.d14, "14d", r.member) + d(r.dall, "all", r.member) +
    "<td>" + spark(r.ser) + "</td></tr>").join("");
  $("roster").innerHTML = "<thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody>";
  for (const th of $("roster").querySelectorAll("th")) {
    const key = th.dataset.k;
    if (!key) continue;
    th.onclick = () => {
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
const textW = (s) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 11.5 : 6.4), 0);
function renderChart() {
  hlId = null; hideTip();
  const lines = members.map((m, i) => {
    const ser = snapSeries(m), base = ser.find((p) => p.c);
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
  const W = 920, L = 62, T = 12, B = 26, GAP = 13;
  const R = Math.min(150, Math.ceil(Math.max(...labeled.map((l) => textW(l.m))) + 22));
  const H = Math.max(280, T + B + labeled.length * GAP + 8);   // tall enough for every label
  let lo = Math.min(...all), hi = Math.max(...all);
  if (lo === hi) { lo -= 1; hi += 1; }
  const padY = (hi - lo) * 0.06; if (state.mode !== "move") lo -= padY; hi += padY;   // movement starts at 0 and cannot go below it
  const t0 = snap.times[0], t1 = snap.times[snap.times.length - 1];
  const x = (t) => t1 === t0 ? (L + W - R) / 2 : L + (t - t0) / (t1 - t0) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const yf = (v) => state.mode === "pct" ? v.toFixed(1) + "%" : fmt(v);
  let svg = '<svg class="big" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="成長曲線">';
  for (let k = 0; k <= 4; k++) {
    const v = lo + (hi - lo) * k / 4, yy = y(v);
    svg += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '"/>' +
      '<text x="' + (L - 8) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end">' + yf(v) + "</text>";
  }
  const ticks = snapTicks(t0, t1);
  const tickText = (t) => mdDay(tpeDay(t));
  ticks.forEach((t, k) => {
    const anchor = ticks.length > 1 && k === 0 ? "start" : ticks.length > 1 && k === ticks.length - 1 ? "end" : "middle";
    svg += '<text x="' + x(t).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + anchor + '">' + tickText(t) + "</text>";
  });
  for (const l of lines) {
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
    svg += '<rect class="hit" data-i="' + it.l.i + '" data-m="' + esc(it.l.m) + '" x="' + (xl - 4) + '" y="' + (it.ty - GAP / 2).toFixed(1) +
      '" width="' + (R - 4) + '" height="' + GAP + '"/><text class="f' + c + '" x="' + xl + '" y="' + (it.ty + 4).toFixed(1) + '">' + esc(it.l.m) + "</text>";
  }
  $("chart").innerHTML = svg + "</svg>";
}

/* ---------- gainers ---------- */
function renderBars() {
  const rows = members.map((m) => ({m, d: delta(snapSeries(m), state.win)})).filter((r) => r.d != null)
    .sort((a, b) => b.d - a.d).slice(0, 10);
  if (!rows.length) { $("bars").innerHTML = '<div class="empty">資料不足，無法比較這個期間</div>'; return; }
  const max = Math.max(...rows.map((r) => Math.abs(r.d))) || 1;
  $("bars").innerHTML = rows.map((r) => '<div class="bar"><div>' + esc(r.m) + '</div><div class="track"><div class="fill' +
    (r.d < 0 ? " neg" : "") + '" style="left:0;width:' + Math.max(2, Math.abs(r.d) / max * 100).toFixed(1) + '%"></div></div><div class="v ' +
    dcls(r.d) + '">' + fmtDelta(r.d) + "</div></div>").join("");
}

/* ---------- page ---------- */
function render() {
  seg($("metrics"), TYPES, state.metric, (v) => { state.metric = v; render(); });
  seg($("modes"), MODES, state.mode, (v) => { state.mode = v; render(); });
  seg($("wins"), WINS, state.win, (v) => { state.win = v; render(); });
  $("hChart").textContent = label(state.metric) + (state.mode === "move" ? "累計位移" : "成長曲線");   // the two titles follow the selected metric
  $("hBars").textContent = label(state.metric) + "漲幅排行";
  renderRoster(); renderChart(); renderBars();
}
load().then(() => {
  if (!snap.times.length) { $("sub").textContent = "尚無資料"; $("roster").innerHTML = '<tbody><tr><td class="empty">尚無資料</td></tr></tbody>'; return; }
  $("sub").classList.toggle("demo", isDemo);
  $("sub").textContent = isDemo ? "【示範模擬資料】" : "";   // empty (and hidden) for real data
  const u = updatedAt;   // e.g. 2026-11-02T14:58:00+08:00 : show it as written, in the collector's time zone
  $("footUpdated").textContent = "更新於 " + (u ? u.slice(0, 10) + " " + u.slice(11, 16) + (u.length > 19 ? "<UTC" + u.slice(19) + ">" : "")
    : "") + " · 共 " + new Set(snap.times.map(tpeDay)).size + " 天、" + snapCount + " 筆";
  render();
}).catch((e) => { $("sub").textContent = "無法載入：" + e.message; });

const qBox = $("q");
let composing = false;
const applySearch = () => { state.q = qBox.value; if (snap.times.length) renderRoster(); };
qBox.addEventListener("compositionstart", () => { composing = true; });
qBox.addEventListener("compositionend", () => { composing = false; applySearch(); });
qBox.addEventListener("input", () => { if (!composing) applySearch(); });

$("roster").addEventListener("mousemove", (ev) => {
  const td = ev.target.closest("td[data-w]");
  if (td) showTip(winTip(td.dataset.m, td.dataset.w), ev); else hideTip();
});
$("roster").addEventListener("mouseleave", hideTip);
$("chart").addEventListener("mousemove", (ev) => {
  const hit = ev.target.closest(".hit");
  if (hit) { highlight(hit.dataset.i); showTip(memberTip(hit.dataset.m), ev); } else { highlight(null); hideTip(); }
});
$("chart").addEventListener("mouseleave", () => { highlight(null); hideTip(); });
