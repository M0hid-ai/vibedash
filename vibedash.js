#!/usr/bin/env node
/**
 *  ⌁ VIBEDASH — a zero-dependency, single-file terminal dashboard.
 *
 *  Turns your machine + local git repos + GitHub activity into a
 *  full-screen, real-time, hacker-movie-style dashboard.
 *
 *  Usage:
 *    node vibedash.js [scanDir] [--user <github-name>] [--once]
 *
 *    node vibedash.js                          -> scans current dir
 *    node vibedash.js ..                       -> scans parent dir
 *    node vibedash.js C:\Users\me\Desktop      -> scans Desktop
 *    node vibedash.js --user mohid             -> pin GitHub user
 *    node vibedash.js --once                   -> print one frame, exit
 *
 *  Keys (live mode):  q quit · j/k page repos · r rescan · g refresh GitHub
 *
 *  No dependencies. No build step. No mercy.
 */
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const argv = process.argv.slice(2);

/* ────────────────────────────── CLI args ───────────────────────────── */

function readFlags(list) {
  const out = { scan: process.cwd(), user: null, once: false, onceLines: null };
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a === '--once' || a === '--test') out.once = true;
    else if (a === '--user') out.user = list[++i] || null;
    else if (a.startsWith('--user=')) out.user = a.slice(7);
    else if (a === '--help' || a === '-h') out.help = true;
    else out.scan = path.resolve(a);
  }
  return out;
}
const CFG = readFlags(argv);

if (CFG.help) {
  console.log(fs.readFileSync(__filename, 'utf8').split('/* ────────────────────────────── CLI args')[0].split('*/')[1]);
  process.exit(0);
}

/* ────────────────────────────── ANSI kit ───────────────────────────── */

const ESC = '\x1b[';

// Style registry: each style id maps to a full SGR emit string.
const S = {
  RESET:   ESC + '0m',
  BOLD:    ESC + '1m',
  FG:      `${ESC}38;2;201;209;217m`,   // soft foreground
  DIM:     `${ESC}2;38;2;110;118;129m`, // dim slate
  ACCENT:  `${ESC}1;38;2;88;166;255m`,  // bold blue
  GREEN:   `${ESC}1;38;2;63;185;80m`,
  AMBER:   `${ESC}1;38;2;210;153;34m`,
  PINK:    `${ESC}1;38;2;219;84;158m`,
  PURPLE:  `${ESC}1;38;2;188;140;255m`,
  CYAN:    `${ESC}1;38;2;76;201;240m`,
  HOT:     `${ESC}1;38;2;255;96;96m`,
  TITLE:   `${ESC}1;2;38;2;255;255;255m`,
  DIMX:    `${ESC}2;38;2;68;76;86m`,    // extra dim (borders)
};
const KEY = Object.keys(S);

const BOX = '─│┌┐└┘';
const SPARK = '▁▂▃▄▅▆▇█';
const SHADE = '░▒▓█';
const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

const strip = (s) => s.replace(ESC + '[0;31m', '').replace(/\x1b\[[0-9;]*m/g, '');
const wid = (s) => strip(s).length;
const fit = (s, w) => {
  // truncate an (ansi) string to visible width w
  let out = '', n = 0, inEsc = false, esc = '';
  for (const ch of s) {
    if (inEsc) { esc += ch; if (/[a-zA-Z]/.test(ch)) { out += esc + ch === esc ? esc : esc; inEsc = false; esc = ''; } continue; }
    if (ch === ESC[0] && true) { }
    if (ch.charCodeAt(0) === 27) { inEsc = true; esc = ch; continue; }
    n += 1;
    if (n > w - 1) { return out + S.DIMX + '…'; }
    out += ch;
  }
  return out;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad = (s, w) => s + S.RESET + ''.padEnd(0) + ' '.repeat(Math.max(0, w - wid(s)));
const padL = (s, w) => ' '.repeat(Math.max(0, w - wid(s))) + s;

function reltime(secAgo) {
  if (secAgo == null) return '—';
  if (secAgo < 60) return 'now';
  if (secAgo < 3600) return Math.floor(secAgo / 60) + 'm';
  if (secAgo < 86400) return Math.floor(secAgo / 3600) + 'h';
  if (secAgo < 86400 * 14) return Math.floor(secAgo / 86400) + 'd';
  if (secAgo < 86400 * 62) return Math.floor(secAgo / (86400 * 7)) + 'w';
  return Math.floor(secAgo / (86400 * 30)) + 'mo';
}

function sparkline(vals, color) {
  const max = Math.max(1, ...vals.map((v) => v[1]));
  let out = '';
  for (const [, v] of vals) {
    const idx = Math.round(((v / max) * (SPARK.length - 1)));
    const c = v === 0 ? S.DIMX : color;
    out += c + SPARK[idx];
  }
  return out + S.RESET;
}

function gauge(pct, width, okColor) {
  pct = clamp(pct, 0, 1);
  const filled = Math.round(pct * width);
  let bar = '';
  for (let i = 0; i < width; i++) {
    const ch = SHADE[Math.min(3, Math.ceil(((i + 1) / width) * 4) - 1)];
    bar += i < filled ? (pct > 0.9 ? S.HOT : pct > 0.75 ? S.AMBER : okColor) + ch : S.DIMX + ' ';
  }
  return bar + S.RESET;
}

/* ──────────────────────────── screen canvas ─────────────────────────── */

const term = {
  w: process.stdout.columns || 100,
  h: process.stdout.rows || 34,
};

let cells = [], styles = [];

function newFrame() {
  cells = Array.from({ length: term.h }, () => new Array(term.w).fill(' '));
  styles = Array.from({ length: term.h }, () => new Array(term.w).fill('DIMX'));
}
function put(x, y, text, style) {
  x = Math.round(x); y = Math.round(y);
  if (y < 0 || y >= term.h) return;
  let cx = x;
  let inEsc = false;
  let cur = style;
  for (const ch of text) {
    if (ch.charCodeAt(0) === 27) { inEsc = true; const m = /\x1b\[[0-9;]*m$/.exec(text.slice(text.indexOf(ch))); continue; }
    if (inEsc) { if (/[a-zA-Z]/.test(ch)) inEsc = false; continue; }
    if (cx >= term.w) break;
    if (cx >= 0) { cells[y][cx] = ch; styles[y][cx] = cur; }
    cx++;
  }
}
// Style-aware puts walk the string, applying inline S codes.
function putStyled(x, y, s) {
  x = Math.round(x); y = Math.round(y);
  if (y < 0 || y >= term.h) return;
  let cx = clamp(x, 0, term.w - 1);
  let acc = '';
  const flush = () => { if (acc) { for (const ch of acc) { if (cx >= term.w) break; cells[y][cx] = ch; styles[y][cx] = 'FLOW'; cx++; } acc = ''; } };
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 27) {
      const m = /^\x1b\[[0-9;]*[A-Za-z]/.exec(s.slice(i));
      if (m) {
        flush();
        const code = m[0];
        // inline style sets marker style for following chars
        const name = KEY.find((k) => S[k] === code) || KEY.map(k => S[k]).includes(code) ? code : 'RESET';
        if (name === 'RESET') { acc += S.RESET; } else { curFlowed = code; acc += code; }
        i += code.length - 1;
        continue;
      }
    }
    acc += s[i];
  }
  flush();
}
let curFlowed = S.FG;

function box(x, y, w, h, title, color) {
  color = color || S.DIMX;
  if (w < 4 || h < 3) return;
  const x2 = x + w - 1, y2 = y + h - 1;
  const dot = (cx, cy, ch) => { if (cx >= 0 && cx < term.w && cy >= 0 && cy < term.h) { cells[cy][cx] = ch; styles[cy][cx] = 'BOX'; boxCol[y][cx] = color; } };
  for (let i = x + 1; i < x2; i++) { dot(i, y, BOX[0]); dot(i, y2, BOX[0]); }
  for (let j = y + 1; j < y2; j++) { dot(x, j, BOX[1]); dot(x2, j, BOX[1]); }
  dot(x, y, BOX[2]); dot(x2, y, BOX[3]); dot(x, y2, BOX[4]); dot(x2, y2, BOX[5]);
  // corners handled by boxCol below
  if (title) {
    const t = ` ${title} `;
    put(x + 2, y, t, 'PANTITLE');
    for (let i = 0; i < t.length; i++) titleCol[y][x + 2 + i] = color;
  }
}
let boxCol = [], titleCol = [];
function initCols() {
  boxCol = Array.from({ length: term.h }, () => new Array(term.w).fill(S.DIMX));
  titleCol = Array.from({ length: term.h }, () => new Array(term.w).fill(S.DIMX));
}

/* ────────────────────────────── state ───────────────────────────────── */

const state = {
  repos: [],
  weeks: new Array(12).fill(0),      // commits per week, all repos
  scanning: false,
  scanDoneAt: null,
  scanMs: null,
  scanFor: CFG.scan,
  gh: { user: CFG.user, loading: false, err: null, data: null, fetchedAt: 0 },
  cpu: { pct: 0, prev: null },
  page: 0,
  spin: 0,
  status: 'booting…',
  start: Date.now(),
};

/* ───────────────────────────── system cpu ───────────────────────────── */

function cpuSample() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const c of cpus) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  const prev = state.cpu.prev;
  state.cpu.prev = { idle, total };
  if (!prev) return null;
  const dIdle = idle - prev.idle, dTotal = total - prev.total;
  if (dTotal <= 0) return null;
  return clamp(1 - dIdle / dTotal, 0, 1);
}

/* ───────────────────────────── git scanning ─────────────────────────── */

const execp = (file, args, opts = {}) =>
  new Promise((res) => {
    execFile(file, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 20000, windowsHide: true, ...opts },
      (err, stdout) => res(err ? null : String(stdout)));
  });

async function findRepoDirs(root, maxDepth = 4) {
  const found = [];
  const q = [[root, 0]];
  while (q.length) {
    const [dir, d] = q.shift();
    let ents;
    try {
      ents = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch { continue; }
    if (ents.some((e) => e.isDirectory() && e.name === '.git')) { found.push(dir); continue; }
    if (d >= maxDepth) continue;
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const n = e.name;
      if (n === '.git' || n === 'node_modules' || n === '.cache' || n === '$RECYCLE.BIN' || n === 'AppData') continue;
      if (n.startsWith('.') && n !== '.config' && n !== '.claude') continue;
      q.push([path.join(dir, n), d + 1]);
    }
  }
  return found.slice(0, 60); // safety cap
}

async function repoInfo(repoPath) {
  const g = (a) => execp('git', ['--no-optional-locks', '-C', repoPath, ...a]);
  const [branch, dirty, log] = await Promise.all([
    g(['rev-parse', '--abbrev-ref', 'HEAD']),
    g(['status', '--porcelain']),
    g(['log', '--since=90.days.ago', '--pretty=format:%at %s', '-n', '500']),
  ]);
  const entries = (log || '').split('\n').filter(Boolean).map((l) => {
    const sp = l.indexOf(' ');
    return { at: parseInt(l.slice(0, sp), 10) || 0, subject: l.slice(sp + 1) };
  }).filter((e) => e.at);
  const buckets = new Array(12).fill(0);
  const nowSec = Date.now() / 1000;
  for (const e of entries) {
    const weeksAgo = Math.floor((nowSec - e.at) / (7 * 86400));
    if (weeksAgo >= 0 && weeksAgo < 12) buckets[11 - weeksAgo]++;
  }
  const dirtyN = dirty ? dirty.trim().split('\n').filter(Boolean).length : 0;
  const clean = dirty == null;
  return {
    name: path.basename(repoPath),
    dir: repoPath,
    branch: (branch || '').trim() || '∅',
    dirty: clean ? -1 : dirtyN,          // -1 = unavailable
    lastAt: entries[0] ? entries[0].at : null,
    subject: entries[0] ? entries[0].subject : 'no commits (90d)',
    commits90: entries.length,
    buckets,
  };
}

function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { await fn(items[idx], idx); } catch { }
    }
  });
  return Promise.all(workers);
}

async function scanRepos() {
  state.scanning = true;
  const t0 = Date.now();
  const dirs = await findRepoDirs(state.scanFor);
  const infos = [];
  await mapLimit(dirs, 6, async (d) => {
    const info = await repoInfo(d);
    if (info) infos.push(info);
  });
  infos.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  state.repos = infos;
  state.weeks = new Array(12).fill(0);
  for (const r of infos) for (let k = 0; k < 12; k++) state.weeks[k] += r.buckets[k];
  state.scanning = false;
  state.scanDoneAt = Date.now();
  state.scanMs = Date.now() - t0;
  state.status = `scanned ${infos.length} repo${infos.length === 1 ? '' : 's'} in ${(state.scanMs / 1000).toFixed(1)}s`;
}

/* ─────────────────────────────── GitHub ─────────────────────────────── */

async function detectGhUser() {
  try {
    const out = await execp('gh', ['api', 'user', '--jq', '.login'], { timeout: 8000 });
    return (out || '').trim() || null;
  } catch { return null; }
}

async function ghFetch(forceUser) {
  const gh = state.gh;
  const user = forceUser || gh.user;
  if (!user) { gh.err = 'no user — rerun with --user <name>'; return; }
  gh.loading = true; gh.err = null;
  try {
    const H = { 'User-Agent': 'vibedash', Accept: 'application/vnd.github+json' };
    const uReq = fetch(`https://api.github.com/users/${encodeURIComponent(user)}`, { headers: H });
    const days = new Map(); // 'YYYY-MM-DD' -> count
    const pages = [1, 2, 3].map((p) =>
      fetch(`https://api.github.com/users/${encodeURIComponent(user)}/events/public?per_page=100&page=${p}`, { headers: H })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []));
    const [uRes, ...evs] = await Promise.all([uReq, ...pages]);
    if (!uRes.ok) throw new Error(`GitHub API ${uRes.status}`);
    const udata = await uRes.json();
    for (const arr of evs) {
      if (!Array.isArray(arr)) continue;
      for (const ev of arr) {
        const d = (ev.created_at || '').slice(0, 10);
        if (d) days.set(d, (days.get(d) || 0) + 1);
      }
    }
    gh.user = udata.login || user;
    gh.data = {
      login: udata.login || user,
      followers: udata.followers ?? null,
      publicRepos: udata.public_repos ?? null,
      createdAt: udata.created_at ? new Date(udata.created_at) : null,
    };
    // 13 weeks of daily counts
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const buckets = [];
    let curStreak = 0, best = 0, run = 0, total = 0, activeDays = 0;
    const firstDay = new Date(today.getTime() - (13 * 7 - 1) * 86400000);
    for (let i = 0; i < 13 * 7; i++) {
      const d = new Date(firstDay.getTime() + i * 86400000);
      const key = d.toISOString().slice(0, 10);
      const c = days.get(key) || 0;
      if (i > 0 && i % 7 === 0) buckets.push(new Array(7).fill(0));
    }
    // rebuild properly: weeks[week][dow]
    const dough = Array.from({ length: 13 }, () => new Array(7).fill(0));
    for (let i = 0; i < 13 * 7; i++) {
      const d = new Date(firstDay.getTime() + i * 86400000);
      const key = d.toISOString().slice(0, 10);
      const c = days.get(key) || 0;
      week: {
        const weekIdx = Math.floor(((today.getTime() - d.getTime()) / 86400000) / 7);
        const dow = (d.getUTCDay() + 6) % 7; // Mon=0
        if (weekIdx >= 0 && weekIdx < 13) dough[12 - weekIdx][dow] = c;
      }
      if (c > 0) { total += c; run++; best = Math.max(best, run); activeDays++; }
      else run = 0;
    }
    // current streak counts back from today
    curStreak = run;
    gh.buckets = dough;
    gh.total = total; gh.activeDays = activeDays;
    gh.bestStreak = best; gh.curStreak = curStreak;
    gh.fetchedAt = Date.now();
    state.status = `github: ${gh.data.login} · ${total} events (90d)`;
  } catch (e) {
    gh.err = String(e.message || e);
  } finally {
    gh.loading = false;
  }
}

/* ────────────────────────────── rendering ───────────────────────────── */

function render() {
  newFrame();
  initCols();
  const w = term.w, h = term.h;

  /* chrome */
  box(0, 0, w, h, null, S.DIMX);
  const spin = SPINNER[state.spin % SPINNER.length];
  const title = ` ⌁ VIBEDASH ${state.scanning || state.gh.loading ? spin : ''} `;
  put(2, 0, title, 'TITLE');
  for (let i = 0; i < title.length; i++) titleCol[0][2 + i] = S.ACCENT;
  const now = new Date();
  const clock = now.toTimeString().slice(0, 8);
  const endTag = ` ${clock} `;
  put(w - 2 - endTag.length, 0, endTag, 'DIM');

  const innerY = 1, innerH = h - 3;
  const leftW = Math.max(30, Math.floor((w - 2) * 0.62));

  /* LEFT panel: repo telescope */
  box(1, innerY, leftW, innerH, 'LOCAL GIT REPOS', S.PURPLE);
  {
    const px = 3, py = innerY + 1, pw = leftW - 4;
    const rows = state.repos;
    const perPage = Math.max(1, innerH - 6);
    const pages = Math.max(1, Math.ceil(rows.length / perPage));
    state.page = clamp(state.page, 0, pages - 1);
    const slice = rows.slice(state.page * perPage, (state.page + 1) * perPage);

    if (!rows.length) {
      put(px, py + 1, state.scanning ? `${spin} scanning ${state.scanFor}…` : 'no git repos found under:', S.DIM);
      put(px, py + 2, fit(state.scanFor, pw), S.ACCENT);
      put(px, py + 3, 'try: node vibedash.js <folder>', S.DIMX);
    } else {
      // header
      put(px, py, `${pad('NAME', 16)}${pad('BRANCH', 11)}${padL('±CHG', 5)}  ${padL('AGE', 4)}  ${pad('COMMITS·90D', 6)}`, 'DIM');
      slice.forEach((r, i) => {
        const y = py + 1 + i;
        const chg = r.dirty < 0 ? S.DIMX + '?'.padStart(5) : r.dirty === 0 ? S.GREEN + '✓'.padStart(5) : S.AMBER + String(r.dirty).padStart(5);
        const name = r.name.length > 16 ? r.name.slice(0, 15) + '…' : r.name.padEnd(16);
        const br = r.branch.length > 10 ? r.branch.slice(0, 9) + '…' : r.branch.padEnd(10);
        put(px, y, `${S.BOLD}${S.FG}${name}${S.RESET}  ${S.ACCENT}${br}${S.RESET}  ${chg}${S.RESET}  ${S.DIM}${padL(reltime((Date.now() / 1000 - r.lastAt) / 1000), 4)}${S.RESET}  ${S.PINK}${String(r.commits90).padStart(6)}${S.RESET}`, 'FLOW');
        // subject line, dim
        put(px, y + 1, '     ' + fit('└ ' + r.subject, pw - 5), 'DIM');
        i++;
      });
    }
    // footer: pager + 12-week sparkline
    const fy = innerY + innerH - 2;
    if (pages > 1) {
      const ptxt = ` ${state.page + 1}/${pages} repos j/k `;
      put(pw - wid(ptxt), fy, ptxt, 'DIM');
    }
    put(px, fy, `${S.DIM}12W ${sparkline(state.weeks.map((v, i) => [i, v]), S.GREEN)} ${S.RESET}${S.GREEN}${state.weeks.reduce((a, b) => a + b, 0)}${S.RESET}${S.DIM} commits${S.RESET}`, 'FLOW');
  }

  /* RIGHT top panel: system vitals */
  const rx = 1 + leftW, rw = w - 1 - rx;
  box(rx, innerY, rw, 13, 'SYSTEM VITALS', S.CYAN);
  {
    const px = rx + 2, py = innerY + 1, pw = rw - 4;
    const cpu = state.cpu.pct;
    const mem = 1 - os.freemem() / os.totalmem();
    const gb = (n) => (n / 1024 ** 3).toFixed(1);
    const gcols = Math.max(8, pw - 16);
    const rows = [
      [`CPU  ${gauge(cpu, gcols, S.GREEN)} ${String(Math.round(cpu * 100)).padStart(3)}%`],
      [`RAM  ${gauge(mem, gcols, S.PURPLE)} ${String(Math.round(mem * 100)).padStart(3)}%`],
      [`     ${gb(os.totalmem() - os.freemem())} / ${gb(os.totalmem())} GB used`],
      [`UP   ${S.GREEN}${fmtUp().padStart(9)}${S.RESET}   ${S.DIM}${os.cpus().length} cores · ${os.platform()} ${os.arch()}${S.RESET}`],
      [`HST  ${S.CYAN}${os.hostname()}${S.RESET}  ${S.DIM}node ${process.version}${S.RESET}`],
    ];
    rows.forEach(([line], i) => put(px, py + i, fit(line, pw), 'FLOW'));
  }

  /* RIGHT bottom panel: GitHub */
  box(rx, innerY + 14, rw, innerH - 14, 'GITHUB', S.PINK);
  {
    const gh = state.gh;
    const px = rx + 2, py = innerY + 15, pw = rw - 4;
    if (gh.err && !gh.loading) {
      put(px, py, '⚠ ' + fit(gh.err, pw - 2), 'AMBER');
      put(px, py + 1, 'fix: node vibedash.js --user <github-login>  ·  or press g', S.DIM);
      if (gh.data) put(px, py + 3, `last good data: ${new Date(gh.fetchedAt).toLocaleTimeString()}`, 'DIMX');
    } else if (gh.loading && !gh.data) {
      put(px, py, `${spin} fetching ${gh.user || '…'} …`, 'DIM');
    } else if (!gh.user && !gh.data) {
      put(px, py, 'no GitHub user. launch with:  --user <login>', 'DIM');
      put(px, py + 1, '(auto-detect via gh failed)', 'DIMX');
    } else {
      const d = gh.data;
      const ageY = gh.buckets || [];
      if (ageY.length) {
        put(px, py, `${S.BOLD}${S.FG}${d.login}${S.RESET}  ${S.DIM}· ${d.publicRepos} repos · ${d.followers} followers${S.RESET}`, 'FLOW');
        // week bars: 13 columns, each bar height = max day intensity
        const by = py + 2;
        put(px, by, S.DIM + 'ACT' + S.RESET, 'FLOW');
        for (let wk = 0; wk < 13 && px + 5 + wk < rx + rw - 2; wk++) {
          const col = ageY[wk].reduce((a, b) => a + b, 0);
          const inten = col === 0 ? 0 : col < 4 ? 1 : col < 9 ? 2 : col < 20 ? 3 : 4;
          const ch = SHADE[inten];
          const colr = inten === 0 ? S.DIMX : inten === 1 ? S.DIM : S.GREEN;
          put(px + 5 + wk, by, colr + ch, 'FLOW');
        }
        put(px + 5 + 13 + 1, by, `${S.GREEN}${gh.total}${S.RESET}${S.DIM} events${S.RESET}`, 'FLOW');
        put(px, by + 1, `${S.DIM}streak  now ${S.GREEN}${gh.curStreak}${S.RESET}  best ${S.PURPLE}${gh.bestStreak}${S.RESET}  active ${gh.activeDays}d${S.RESET}`, 'FLOW');
        if (gh.fetchedAt) put(px, by + 3, `${S.DIMX}updated ${new Date(gh.fetchedAt).toLocaleTimeString()} · press g to refetch${S.RESET}`, 'FLOW');
      } else {
        put(px, py, `${S.BOLD}${d.login}${S.RESET}  ${S.DIM}(no recent events)${S.RESET}`, 'FLOW');
      }
    }
  }

  /* footer */
  const fy = h - 2;
  put(2, fy, ` q quit · j/k page · r rescan · g refresh gh `, 'DIM');
  const st = fit(state.status, w - 4 - wid(` q quit · j/k page · r rescan · g refresh gh `));
  put(w - 2 - st.length, fy, st, 'ACCENT');

  /* composite */
  const lines = [];
  for (let y = 0; y < h; y++) {
    let line = '', lastCode = null;
    for (let x = 0; x < term.w; x++) {
      let stName = styles[y][x];
      let code;
      if (stName === 'BOX') code = boxCol[y][x];
      else if (stName === 'PANTITLE') code = titleCol[y][x];
      else if (stName === 'TITLE') code = S.ACCENT;
      else if (stName === 'FLOW') code = null;
      else code = S[stName];
      if (code && code !== lastCode) { line += code; lastCode = code; }
      line += cells[y][x];
    }
    lines.push(line + S.RESET);
  }
  return lines.join('\n') + S.RESET;
}

function fmtUp() {
  let s = Math.floor((Date.now() - state.start) / 1000);
  const d = Math.floor(s / 86400); s %= 86400;
  const hh = Math.floor(s / 3600); s %= 3600;
  const mm = Math.floor(s / 60);
  return `${d ? d + 'd ' : ''}${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/* ─────────────────────────────── app loop ───────────────────────────── */

const isTTY = process.stdout.isTTY;

function draw() {
  const out = render();
  process.stdout.write(ESC + '?2026h' + ESC + 'H' + ESC + 'J' + out + ESC + '?2026l');
  // reposition cursor bottom-left for cleanliness
}

function withAlt() { process.stdout.write(ESC + '?1049h' + ESC + '?25l'); }
function withoutAlt() { process.stdout.write(ESC + '0m' + ESC + '?25h' + ESC + '?1049l'); }

function main() {
  if (!isTTY && !CFG.once) {
    console.log('VibeDash needs a real terminal. Try:  node vibedash.js   (inside Windows Terminal / any tty)\n' +
      'Or preview one frame:                node vibedash.js --once');
    process.exit(1);
  }

  let shutdown = false;
  const die = () => {
    if (shutdown) return;
    shutdown = true;
    if (isTTY && !CFG.once) withoutAlt();
    // give the restore sequence a beat to flush, then exit cleanly
    setTimeout(() => process.exit(0), 50).unref?.();
  };
  process.on('SIGINT', die);
  process.on('SIGTERM', die);
  process.on('exit', () => { if (!shutdown) { shutdown = true; if (isTTY && !CFG.once) withoutAlt(); } });

  if (CFG.once) {
    state.status = 'preview frame (not live)';
    (async () => {
      await scanRepos();
      if (!state.gh.user) state.gh.user = await detectGhUser();
      cpuSample();
      await new Promise((r) => setTimeout(r, 250));
      state.cpu.pct = cpuSample() ?? 0.07;
      if (state.gh.user) await ghFetch();
      term.w = clamp(process.stdout.columns || 120, 80, 200);
      term.h = clamp(process.stdout.rows || 38, 24, 60);
      console.log(render());
      // exit naturally: let stdout drain instead of hard-setExit (Windows aborts otherwise)
      process.exitCode = 0;
    })();
    return;
  }

  /* live mode */
  withAlt();
  process.stdout.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (k) => {
    if (k === 'q' || k === 'Q' || k === '\x03') die();
    else if (k === 'r') { state.status = 'rescanning…'; scanRepos(); }
    else if (k === 'g') { ghFetch(); }
    else if (k === 'j') { state.page++; }
    else if (k === 'k') { state.page = Math.max(0, state.page - 1); }
    else if (k === '\x1b[C' || k === 'l') { state.page++; }
    else if (k === '\x1b[D' || k === 'h') { state.page = Math.max(0, state.page - 1); }
  });

  process.stdout.on('resize', () => {
    term.w = clamp(process.stdout.columns, 80, 220);
    term.h = clamp(process.stdout.rows, 20, 70);
    draw();
  });

  // github user bootstrap
  if (!state.gh.user) detectGhUser().then((u) => { if (u) { state.gh.user = u; ghFetch(); } });
  if (state.gh.user) ghFetch();

  scanRepos();

  // cpu ticker
  tickCpu();
  setInterval(tickCpu, 1000);
  let lastRenderDay = null;
  setInterval(() => {
    state.spin++;
    draw();
  }, 500);

  function tickCpu() {
    const v = cpuSample();
    if (v != null) state.cpu.pct = state.cpu.pct * 0.7 + v * 0.3; // smoothing
  }

  // periodic auto-rescan of git repos (every 2 min)
  setInterval(() => { if (!state.scanning) scanRepos(); }, 120000);
  // periodic gh refresh (every 10 min)
  setInterval(() => { if (state.gh.user && !state.gh.loading) ghFetch(); }, 600000);

  draw();
}

main();
