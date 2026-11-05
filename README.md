# ⌁ VIBEDASH

A **zero-dependency, single-file terminal dashboard** that turns your machine into the hacker-movie screen — except every pixel is *your real data*.

```
┌── ⌁ VIBEDASH ──────────────────────────────┬── SYSTEM VITALS ──────┐
│ LOCAL GIT REPOS                            │ CPU  ███████░░ 34%    │
│ my-app    main     ✓    2h   001231        │ RAM  ████░░░░ 52%     │
│      └ fix: stop the race condition        │ UP    03:41   8 cores │
│ server    dev      12   5m   000456        ├── GITHUB ─────────────┤
│ …                                          │ mohid ▓▓░▓▓▓░▓ 128 ev │
│ 12W ▁▂▅▇█▆▂▁▂▄▃▁ 231 commits               │ streak now 4  best 17 │
└────────────────────────── q quit · r rescan ┴───────────────────────┘
```

## What it shows

| Panel | Data source |
|---|---|
| **SYSTEM VITALS** | Live CPU % (sampled, smoothed), RAM pressure, uptime, cores/platform, hostname |
| **LOCAL GIT REPOS** | Recursively finds every git repo under a folder, showing branch, dirty file count, last commit age, 90-day commit count |
| **12W sparkline** | Aggregated commits-per-week across all repos, last 12 weeks |
| **GITHUB** | Recent activity (events/90d), current + best streak, followers/repos, colored intensity bar |

## Run it

Requires Node ≥ 16. **No `npm install`. Ever.**

```bash
# scan the current directory for repos
node vibedash.js

# scan anywhere else
node vibedash.js C:\Users\you\Desktop
node vibedash.js ~/projects

# pin a GitHub user (default: auto-detects from `gh` CLI)
node vibedash.js --user yourname

# preview a single frame (for CI / screenshots)
node vibedash.js <folder> --once
```

## Keys

| Key | Action |
|---|---|
| `q` | quit |
| `j` / `k` (or arrows) | page through repos |
| `r` | rescan repos now |
| `g` | refetch GitHub now |

## Why it's different

- **One file.** Drop `vibedash.js` on any machine with Node and it just runs.
- **Flicker-free.** Uses synchronized ANSI updates (`CSI ?2026`) so there's zero tearing.
- **Everything local.** CPU/RAM from `os`, git via the `git` binary itself, GitHub via the public REST API (no token needed for public activity).

## License

MIT
