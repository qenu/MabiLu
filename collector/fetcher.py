"""Fetch rankings through a real browser (Selenium).

One call per member: ranking_type=total returns a page of 20 rows around the
member. Each row has the total rank, the total value and all 3 powers. Every
guild member found on a page is recorded, so a later member on the same page
needs no call of its own.

The requests run inside the tw.nexon.com page, like the console script does,
so Cloudflare sees a normal browser session. On HTTP 403/429 or an unexpected
response we stop at once. We never retry and never try to evade a block.
"""
import json
import time
from typing import NamedTuple
from urllib.parse import urlencode

import snapshot
from const import (
    API_URL,
    CLASS_HASH_TO_NAME,
    DELAY_SEC,
    RETRIES,
    RETRY_WAIT_SEC,
    PROFILE_DIR,
    RANKING_TYPE,
    SITE_URL,
    PLAYERS_FILE,
    WORLD_ID,
)

# Runs in the page. Calls back with [status, body_text] or [0, error_text].
FETCH_JS = """
const url = arguments[0], done = arguments[arguments.length - 1];
fetch(url, {credentials: "include"})
  .then(r => r.text().then(t => done([r.status, t])))
  .catch(e => done([0, String(e)]));
"""


class StopRun(Exception):
    """A block or an unexpected response. The run must end."""


class FetchResult(NamedTuple):
    data: dict      # {member: record, or None when not found}
    stopped: str    # reason, or "" when the run finished
    errors: int     # unreadable rows (those members are None)
    requests: int   # members' calls made (not counting retries)
    retries: int = 0  # extra tries made after a failed call


def build_url(nickname):
    qs = urlencode({
        "world_id": WORLD_ID,
        "ranking_type": RANKING_TYPE,
        "role_name": nickname,
    })
    return f"{API_URL}?{qs}"


def parse_page(status, text):
    """Return {name: row} for every row on the page (this world only).

    Raises StopRun for a block or an unexpected response shape.
    """
    if status in (403, 429):
        raise StopRun(f"HTTP {status} (blocked or rate limited): {text[:300]}")
    try:
        raw = json.loads(text)
    except ValueError:
        raise StopRun(f"HTTP {status}: response is not JSON: {text[:300]}")
    rows = (raw.get("data") or {}).get("ranking") if isinstance(raw, dict) else None
    if not isinstance(raw, dict) or raw.get("code") != 0 or not isinstance(rows, list):
        raise StopRun(f"unexpected response shape: {text[:300]}")
    page = {}
    for row in rows:
        sm = (row or {}).get("string_map") or {}
        if sm.get("gc_name") and str(row.get("world_id")) == str(WORLD_ID):
            page[sm["gc_name"]] = row
    return page


def _power(x):
    try:
        return int(float(x))
    except (TypeError, ValueError):
        return None


def to_record(row):
    """Turn one API row into a snapshot record. Raises ValueError/KeyError if unreadable.

    The total is not kept: it is the sum of the 3 powers. `rank` is the total rank.
    """
    sm = row["string_map"]
    h = "" if sm.get("gc_class") is None else str(sm["gc_class"])
    return {
        "char_name": sm["gc_name"],
        "class": CLASS_HASH_TO_NAME.get(h, f"unknown_class:{h}"),
        "rank": int(row["ranking"]),
        "combatpower": _power(sm.get("gc_combat_power")),
        "livingpower": _power(sm.get("life_power")),
        "attractiveness": _power(sm.get("attractiveness_power")),
    }


def load_players(path=PLAYERS_FILE):
    """Read the member names from player.json. Raise SystemExit with a clear message if it is wrong."""
    try:
        names = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise SystemExit(f"cannot read {path.name}: {e}")
    if not isinstance(names, list) or not names or not all(isinstance(n, str) and n.strip() for n in names):
        raise SystemExit(f"{path.name} must be a non-empty JSON list of names")
    names = [n.strip() for n in names]
    dupes = sorted({n for n in names if names.count(n) > 1})
    if dupes:
        raise SystemExit(f"{path.name} has duplicate names: {', '.join(dupes)}")
    return names


def order_by_rank(users, ranks):
    """Best rank first; members with no known rank go last, in their old order.

    A page is 20 rows starting 2 ranks above the member. If we ask for the best
    ranked member of a close group first, that one page holds the rest of the group.
    """
    return sorted(users, key=lambda u: (ranks.get(u) is None, ranks.get(u) or 0))


def fetch_users(fetch_page, users, delay=DELAY_SEC, sleep=time.sleep, log=print,
                 retries=RETRIES, retry_wait=RETRY_WAIT_SEC):
    """Fetch every member. fetch_page(url) -> (status, text). Easy to test with a fake.

    A failed call is tried again up to `retries` times, with growing waits. The same
    request is sent again, nothing else changes. If it still fails, the run stops.
    """
    wanted, data = set(users), {}
    errors = requests = retried = 0

    def get_page(url):
        nonlocal retried
        reason = ""
        for attempt in range(retries + 1):
            if attempt:
                wait = retry_wait[min(attempt - 1, len(retry_wait) - 1)]
                log(f"retry {attempt}/{retries} in {wait}s: {reason}")
                retried += 1
                sleep(wait)
            status, text = fetch_page(url)
            if status == 0:
                reason = f"network error: {text}"
                continue
            try:
                return parse_page(status, text)
            except StopRun as e:
                reason = str(e)
        raise StopRun(f"gave up after {retries} retries: {reason}")

    stopped = ""
    try:
        for user in users:
            if user in data:                       # already on an earlier page
                continue
            if requests:
                sleep(delay)
            page = get_page(build_url(user))
            requests += 1
            for name, row in page.items():
                if name in wanted and name not in data:
                    try:
                        data[name] = to_record(row)
                    except (KeyError, ValueError, TypeError):
                        data[name] = None
                        errors += 1
                        log(f"{name:<8} unreadable row")
                        continue
                    note = "" if name == user else f"  (found on {user}'s page)"
                    r = data[name]
                    log(f"{name:<8} #{r['rank']} {r['combatpower']}/{r['livingpower']}/{r['attractiveness']}{note}")
            if user not in data:                   # not on its own page: not found
                data[user] = None
                log(f"{user:<8} not found")
    except StopRun as e:
        stopped = str(e)
    return FetchResult({u: data[u] for u in users if u in data}, stopped, errors, requests, retried)


def make_driver(browser="chrome"):
    from selenium import webdriver

    if browser == "safari":
        # One-time setup: `safaridriver --enable`, then Safari > Develop >
        # Allow Remote Automation. Safari starts each session with clean cookies.
        return webdriver.Safari()
    if browser != "chrome":
        raise SystemExit(f"unknown browser {browser!r}: use chrome or safari")
    opts = webdriver.ChromeOptions()
    opts.add_argument(f"--user-data-dir={PROFILE_DIR}")
    opts.add_argument("--window-size=1100,800")
    return webdriver.Chrome(options=opts)  # visible window, not headless


def fetch_all(browser="chrome", users=None, log=print):
    from selenium.webdriver.support.ui import WebDriverWait

    users = order_by_rank(users or load_players(), snapshot.latest_ranks())
    driver = make_driver(browser)
    driver.set_script_timeout(30)
    try:
        driver.get(SITE_URL)
        WebDriverWait(driver, 30).until(
            lambda d: d.execute_script("return document.readyState") == "complete"
        )
        return fetch_users(lambda url: driver.execute_async_script(FETCH_JS, url), users, log=log)
    finally:
        driver.quit()
