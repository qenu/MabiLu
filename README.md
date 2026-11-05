# mabilookup

Guild member tracking for Mabinogi Mobile (TW). Two separate parts:
the **collector** gets the data, and the **site** only shows it.

    player.json          the guild members (in-game names)
    collector/           fetch, format, commit, push
    docs/                the static site (GitHub Pages) and its data

## 1. Collector (`collector/`)
Needs `uv` and Chrome. It opens a visible Chrome window and calls the ranking API from inside the
tw.nexon.com page. A plain script gets HTTP 403 from Cloudflare, so a real browser is required.

    uv run collector/run.py                   # fetch, write, commit, push
    uv run collector/run.py --no-push         # commit only
    uv run collector/run.py --no-git          # write the files only
    uv run collector/run.py --dry-run         # fetch and print, write nothing
    uv run collector/run.py --rebuild-only    # rebuild docs/series.json from the raw log
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

**Discord webhook (optional):** after every run the collector posts one message to a Discord webhook.
- Pass: `✅ OK`, with the counts (found, not found, calls, retries) and `next run <t:…:R>`.
  Not-found members or unreadable rows change it to `⚠️ done with warnings`. It does not ping.
- Fail (stopped, crashed, or git failed): `❌`, the reason, and `next run`. It pings `ALERT_MENTION`
  (`@everyone` by default; `@here` or `""` in `const.py`).
- Times are Discord time tags, so you see them in your own time zone and they keep counting.
- `--dry-run` never posts.

The URL is a secret, so it is not in `const.py` (this repo is public). Set it in one of two ways:

    export MABILOOKUP_WEBHOOK='https://discord.com/api/webhooks/...'
    # or put only the URL in a file named webhook.url in the project root (git-ignored)

    uv run collector/run.py --test-webhook    # posts one pass message and one fail alert

**Schedule (macOS launchd):** the run times are `RUN_TIMES` in `const.py`
(02:00, 08:00, 14:00, 23:00). launchd uses the Mac's own time zone, so the Mac must be set to Taipei time.

    uv run collector/launchd.py               # writes the job file and prints the commands
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mabilookup.collector.plist
    launchctl kickstart -k gui/$(id -u)/com.mabilookup.collector    # run it now, to test

The log is `logs/run.log` (git-ignored). On the Mac, turn off automatic sleep, stay logged in
(Chrome needs a desktop session), and use `webhook.url` (the job does not see your shell's `export`).
To change the times: edit `RUN_TIMES`, run `launchd.py` again, then `launchctl bootout` and `bootstrap`.

## 2. Site (`docs/`)
Static page. It reads `docs/series.json` and draws the tables and charts. No build step.

    cd docs && python3 -m http.server       # then open http://localhost:8000

Publish: GitHub Settings > Pages > branch `main`, folder `/docs`.

## Data
    docs/snapshots/<YYYY-MM-DD>.json   raw log: a list, each run appends one snapshot (Asia/Taipei day)
    docs/series.json                   every snapshot in columns; the only file the site reads; rebuilt on every run

A snapshot has one record per member that was found:
`char_name`, `class`, `rank`, `combatpower`, `livingpower`, `attractiveness`.
- `rank` is the total rank. The game gives no separate rank for the 3 powers.
- The total (綜合) is not stored. It is the sum of the 3 powers, the same as the game's total.
- A member who was not found has no record.

The site shows every snapshot as it is. There is no daily-max rule, so a dip (a gear swap, for example) is shown as it happened.
`series.json` has, for each member, the 3 powers, the total rank and the newest class, one value per snapshot.
The site adds the 3 powers to get the total. The file grows by about 1.2 KB per snapshot (about 1.7 MB a year at 4 runs a day).

**Change columns (1 日, 3 日, 14 日, 全期間):** the newest snapshot minus a start snapshot. For 1 日, 3 日 and 14 日 the
start is the snapshot nearest to (newest time - window), if one is within 6 hours of that time. If there is none, the cell
shows `–`. 全期間 starts at the member's first snapshot. A member who is not in the newest snapshot shows `–`.

**Chart buttons:** 數值 (the value), 成長 % (growth since the first snapshot) and 位移 (cumulative movement).
位移 starts each member at 0 and adds the size of every change between snapshots, whether it went up or down.
A flat line means the member did nothing, and a steep line means the member is active. The end of the line is the member's
total movement. It is the same "up" plus "down" as the table hover, added over the whole period.

Hover details:
- **A change cell in the table:** the number split into what went up and what went down, snapshot by snapshot.
  For example, `+2` can be `+8,467 -8,465`: a big swing that ends flat, so the member is active.
  Up + down is always exactly the number in the cell. It also shows how many snapshots changed and the time range.
- **A name at the end of a chart line:** class, latest powers, rank, the changes of the selected metric,
  and the last day's ups and downs. The line is highlighted and the others are dimmed.

The chart lines are curved with a monotone curve (`curvePath` in `docs/app.js`). Between two points
the line never goes above the higher point or below the lower one, so it shows no peak or dip that is not in the data.
A line with only 2 points stays straight.
