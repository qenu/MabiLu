"use strict";
/* Reads daily.json (one request) and draws tables and charts.
   It never writes data and never calls Nexon.
   The collector builds daily.json: for each day, member and metric it keeps the
   HIGHEST value of that day. "綜合" (total) and its rank come from the game's own
   total ranking; the 3 powers have no separate rank. */

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
const MODES = [{id: "value", label: "數值"}, {id: "pct", label: "成長 %"}];
const DAY = 86400000;

const state = {metric: TYPES[0].id, sort: {key: "value", dir: -1}, win: "1d", mode: "value", q: ""};
let days = [], members = [], snapCount = 0, isDemo = false, updatedAt = "";
const DEMO = new URLSearchParams(location.search).has("demo"); // ?demo loads demo/daily.json

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const fmt = (n) => n == null ? "–" : Number(n).toLocaleString("en-US", {maximumFractionDigits: 0});
const fmtDelta = (n) => n == null ? "–" : (n > 0 ? "+" : "") + fmt(n);
const dcls = (d) => d > 0 ? "up" : d < 0 ? "down" : "mut";
const mdDay = (day) => parseInt(day.slice(5, 7), 10) + "/" + parseInt(day.slice(8, 10), 10);
const mdT = (t) => mdDay(new Date(t).toISOString().slice(0, 10)); // t is a UTC midnight
const label = (id) => TYPES.find((t) => t.id === id).label;

/* ---------- data ---------- */
async function load() {
  const url = DEMO ? "demo/daily.json" : "daily.json";
  const r = await fetch(url, {cache: "no-store"});
  if (!r.ok) throw new Error(url + " HTTP " + r.status);
  const j = await r.json();
  isDemo = !!j.demo;
  snapCount = j.snapshot_count || 0;
  updatedAt = j.updated_at || "";
  days = Object.entries(j.days || {})
    .map(([day, data]) => ({day, t: Date.parse(day + "T00:00:00Z"), data}))
    .sort((a, b) => a.t - b.t);
  const seen = new Set();
  for (let i = days.length - 1; i >= 0; i--) for (const m of Object.keys(days[i].data)) seen.add(m);
  members = [...seen];
}
const cell = (d, m, type) => (d.data[m] && d.data[m][type]) || null;
const series = (m, type) => days.map((d) => ({t: d.t, day: d.day, c: cell(d, m, type)}));
function memberClass(m) {
  for (let i = days.length - 1; i >= 0; i--)
    for (const t of TYPES) { const c = cell(days[i], m, t.id); if (c && c.class) return c.class; }
  return "?";
}
function delta(ser, win) {
  const n = ser.length, cur = n ? ser[n - 1] : null;
  if (!cur || !cur.c) return null;
  if (win === "all") {
    const first = ser.find((p) => p.c);
    return first && first !== cur ? cur.c.value - first.c.value : null;
  }
  const limit = cur.t - WINS.find((w) => w.id === win).days * DAY;
  for (let i = n - 2; i >= 0; i--) if (ser[i].t <= limit && ser[i].c) return cur.c.value - ser[i].c.value;
  return null;
}

/* ---------- controls ---------- */
function seg(el, items, current, onPick) {
  el.innerHTML = items.map((i) => '<button data-v="' + i.id + '" aria-pressed="' + (i.id === current) + '">' + i.label + "</button>").join("");
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
  const d = pts.map((p, i) => (i ? "L" : "M") + x(p.t).toFixed(1) + " " + y(p.c.value).toFixed(1)).join(" ");
  return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h +
    '"><path d="' + d + '" fill="none" stroke="var(--acc)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function buildRows() {
  return members.map((m) => {
    const ser = series(m, state.metric), last = ser[ser.length - 1].c;
    return {member: m, cls: memberClass(m), value: last ? last.value : null, rank: last ? last.rank : null,
      d1: delta(ser, "1d"), d3: delta(ser, "3d"), d14: delta(ser, "14d"), dall: delta(ser, "all"), ser};
  });
}
function renderStats(rows) {
  const v = rows.map((r) => r.value).filter((x) => x != null).sort((a, b) => a - b), n = v.length;
  const latest = days[days.length - 1].day;
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
  const d = (v) => '<td class="num ' + dcls(v) + '">' + fmtDelta(v) + "</td>";
  const q = state.q.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.member.toLowerCase().includes(q) || r.cls.toLowerCase().includes(q)) : rows;
  const body = !shown.length ? '<tr><td class="empty" colspan="' + cols.length + '">沒有符合「' + esc(state.q.trim()) + '」的成員</td></tr>' : shown.map((r) => "<tr><td>" + esc(r.member) + "</td><td>" + esc(r.cls) + '</td><td class="num">' + fmt(r.value) +
    "</td>" + (showRank ? '<td class="num mut">' + (r.rank == null ? "–" : "#" + fmt(r.rank)) + "</td>" : "") + d(r.d1) + d(r.d3) + d(r.d14) + d(r.dall) +
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
const textW = (s) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 11.5 : 6.4), 0);
function renderChart() {
  const lines = members.map((m, i) => {
    const ser = series(m, state.metric), base = ser.find((p) => p.c);
    const ys = ser.map((p) => {
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
  const padY = (hi - lo) * 0.06; lo -= padY; hi += padY;
  const t0 = days[0].t, t1 = days[days.length - 1].t;
  const x = (t) => t1 === t0 ? (L + W - R) / 2 : L + (t - t0) / (t1 - t0) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const yf = (v) => state.mode === "pct" ? v.toFixed(1) + "%" : fmt(v);
  let svg = '<svg class="big" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="成長曲線">';
  for (let k = 0; k <= 4; k++) {
    const v = lo + (hi - lo) * k / 4, yy = y(v);
    svg += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '"/>' +
      '<text x="' + (L - 8) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end">' + yf(v) + "</text>";
  }
  const ticks = days.length === 1 ? [t0] : days.length === 2 ? [t0, t1] : [t0, Math.round((t0 + t1) / 2 / DAY) * DAY, t1];
  ticks.forEach((t, k) => {
    const anchor = ticks.length > 1 && k === 0 ? "start" : ticks.length > 1 && k === ticks.length - 1 ? "end" : "middle";
    svg += '<text x="' + x(t).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + anchor + '">' + mdT(t) + "</text>";
  });
  for (const l of lines) {
    const c = l.i % 10;
    let d = "", gap = true;
    l.ser.forEach((p, j) => {
      if (l.ys[j] == null) { gap = true; return; }
      d += (gap ? "M" : "L") + x(p.t).toFixed(1) + " " + y(l.ys[j]).toFixed(1) + " ";
      gap = false;
    });
    svg += '<path class="ln l' + c + '" d="' + d + '"><title>' + esc(l.m) + "</title></path>";
    l.ser.forEach((p, k) => {            // a lone point has no line, so draw it as a dot
      if (l.ys[k] == null || (k > 0 && l.ys[k - 1] != null) || (k < l.ys.length - 1 && l.ys[k + 1] != null)) return;
      svg += '<circle class="f' + c + '" cx="' + x(p.t).toFixed(1) + '" cy="' + y(l.ys[k]).toFixed(1) + '" r="3"><title>' +
        esc(l.m + " · " + mdDay(p.day) + " · " + fmt(p.c.value)) + "</title></circle>";
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
      svg += '<line class="lead l' + c + '" x1="' + (it.px + 4).toFixed(1) + '" y1="' + it.py.toFixed(1) + '" x2="' + (xl - 3) + '" y2="' + it.ty.toFixed(1) + '"/>';
    svg += '<text class="f' + c + '" x="' + xl + '" y="' + (it.ty + 4).toFixed(1) + '">' + esc(it.l.m) + "</text>";
  }
  $("chart").innerHTML = svg + "</svg>";
}

/* ---------- gainers ---------- */
function renderBars() {
  const rows = members.map((m) => ({m, d: delta(series(m, state.metric), state.win)})).filter((r) => r.d != null)
    .sort((a, b) => b.d - a.d).slice(0, 10);
  if (!rows.length) { $("bars").innerHTML = '<div class="empty">資料天數不足，無法比較這個期間</div>'; return; }
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
  $("hChart").textContent = label(state.metric) + "成長曲線";   // the two titles follow the selected metric
  $("hBars").textContent = label(state.metric) + "漲幅排行";
  renderRoster(); renderChart(); renderBars();
}
load().then(() => {
  if (!days.length) { $("sub").textContent = "尚無快照"; $("roster").innerHTML = '<tbody><tr><td class="empty">尚無資料</td></tr></tbody>'; return; }
  $("sub").classList.toggle("demo", isDemo);
  $("sub").textContent = isDemo ? "【示範模擬資料】" : "";   // empty (and hidden) for real data
  const u = updatedAt;   // e.g. 2026-11-02T14:58:00+08:00 : show it as written, in the collector's time zone
  $("footUpdated").textContent = "更新於 " + (u ? u.slice(0, 10) + " " + u.slice(11, 16) + (u.length > 19 ? "<UTC" + u.slice(19) + ">" : "")
    : days[days.length - 1].day) + " · 共 " + days.length + " 天、" + snapCount + " 筆快照";
  render();
}).catch((e) => { $("sub").textContent = "無法載入：" + e.message + (DEMO ? "。請先執行 python3 pending/make_demo.py" : ""); });

const qBox = $("q");
let composing = false;
const applySearch = () => { state.q = qBox.value; if (days.length) renderRoster(); };
qBox.addEventListener("compositionstart", () => { composing = true; });
qBox.addEventListener("compositionend", () => { composing = false; applySearch(); });
qBox.addEventListener("input", () => { if (!composing) applySearch(); });
