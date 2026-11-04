# mabilookup

Guild member tracking for Mabinogi Mobile (TW). Two separate parts.

## 1. Collector (`collector/`)
Fetches rankings in a real browser (Selenium), one call per member, appends one snapshot to the day file,
rebuilds the rollup, commits, pushes.

    uv run collector/run.py                   # Chrome; commit and push
    uv run collector/run.py --browser safari  # needs: safaridriver --enable
    uv run collector/run.py --no-push         # commit only
    uv run collector/run.py --dry-run         # fetch and print only
    uv run collector/run.py --rebuild-only    # rebuild docs/daily.json from the raw log
    python3 pending/test_collector.py         # offline tests (parked in pending/)

Members: edit `player.json` (a JSON list of in-game names, one per member).
A stopped run (HTTP 403/429, bad response) writes nothing.

## 2. Site (`docs/`)
Static page. It reads `docs/daily.json` and draws tables and charts. No build step.
Preview: `cd docs && python3 -m http.server`, then open http://localhost:8000.
Demo with fake history: `python3 pending/make_demo.py`, then open http://localhost:8000/?demo
(parked in `pending/`; writes `docs/demo/daily.json`; git-ignored; the real data is never touched).
Publish: GitHub Settings > Pages > branch `main`, folder `/docs`.

## Data
    docs/snapshots/<YYYY-MM-DD>.json   raw log: a list, every run appends one snapshot (Asia/Taipei day)
    docs/daily.json                    rollup the site reads; rebuilt on every run

One API call per member (`ranking_type=total`) gives the total rank, the total value and all 3 powers.
Every guild member on a returned page (20 rows) is recorded, so some members need no call of their own.
Each snapshot holds one record per member: `char_name`, `class`, `rank`, `combatpower`, `livingpower`, `attractiveness`.
The total is not stored. It is the sum of the 3 powers (same as the game's total).
The game gives no separate rank for the 3 powers in this call, so only the total (綜合) has a rank.

Rollup rule: per day, member and metric, keep the HIGHEST value of that day.
The collector writes data. The site only reads it.
