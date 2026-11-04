# mabilookup

Guild member tracking for Mabinogi Mobile (TW). Two separate parts:
the **collector** gets the data, and the **site** only shows it.

    player.json          the guild members (in-game names)
    collector/           fetch, format, commit, push
    docs/                the static site (GitHub Pages) and its data
    pending/             tests and demo tools, parked for now (git-ignored)

## 1. Collector (`collector/`)
Needs `uv` and Chrome. It opens a visible Chrome window and calls the ranking API from inside the
tw.nexon.com page. A plain script gets HTTP 403 from Cloudflare, so a real browser is required.

    uv run collector/run.py                   # fetch, write, commit, push
    uv run collector/run.py --no-push         # commit only
    uv run collector/run.py --no-git          # write the files only
    uv run collector/run.py --dry-run         # fetch and print, write nothing
    uv run collector/run.py --rebuild-only    # rebuild docs/daily.json from the raw log
    uv run collector/run.py --browser safari  # needs: safaridriver --enable

**Members:** edit `player.json`. It is a JSON list of in-game names, one per member.
A name that is spelled wrong shows up as "not found" in the run summary.

**Calls:** one call per member (`ranking_type=total`). A page holds 20 ranks, and the collector keeps
every guild member on it. It fetches members in order of their last known total rank, so close-ranked
members share one page. The first run has no ranks yet and may use one call per member.
Calls are 3 seconds apart.

**Retries and stops:** a failed call (network error, HTTP 403/429/5xx, or a page that is not the
API's JSON) is sent again up to 3 times, after 15, 45 and 120 seconds (`RETRIES`, `RETRY_WAIT_SEC`
in `const.py`). It is the same request, and nothing is changed to get around a block.
If the call still fails, the run stops. It writes nothing and sends the webhook alert.

**Webhook alert (optional):** a Discord or Slack incoming webhook gets a message when a run stops,
crashes (for example Chrome does not start), or when git fails. The URL is a secret, so it is not in
`const.py` (this repo is public). Set it in one of two ways:

    export MABILOOKUP_WEBHOOK='https://discord.com/api/webhooks/...'
    # or put only the URL in a file named webhook.url in the project root (git-ignored)

    uv run collector/run.py --test-webhook    # send one test message

## 2. Site (`docs/`)
Static page. It reads `docs/daily.json` and draws the tables and charts. No build step.

    cd docs && python3 -m http.server       # then open http://localhost:8000

Publish: GitHub Settings > Pages > branch `main`, folder `/docs`.

## Data
    docs/snapshots/<YYYY-MM-DD>.json   raw log: a list, each run appends one snapshot (Asia/Taipei day)
    docs/daily.json                    rollup the site reads; rebuilt on every run

A snapshot has one record per member that was found:
`char_name`, `class`, `rank`, `combatpower`, `livingpower`, `attractiveness`.
- `rank` is the total rank. The game gives no separate rank for the 3 powers.
- The total (綜合) is not stored. It is the sum of the 3 powers, the same as the game's total.
- A member who was not found has no record.

Rollup rule: for each day, member and metric, keep the HIGHEST value of that day.

## Pending (`pending/`)
Parked for now, and not published.

    python3 pending/test_collector.py   # offline tests
    python3 pending/make_demo.py        # fake history; open http://localhost:8000/?demo

The demo writes `docs/demo/daily.json` (git-ignored). Your real data is never touched.
