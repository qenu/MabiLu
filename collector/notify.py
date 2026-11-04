"""Send a short Discord message after every run: a summary when it passed, an alert when it failed.

Uses a Discord incoming webhook. The messages use Discord time tags (<t:UNIX:R>), which each
reader sees in their own time zone and which keep counting ("2 hours ago") after the post.
Nothing here raises. A broken webhook must not hide the real error or change the exit code.
"""
import json
import urllib.request

from const import ALERT_MENTION, WEBHOOK_URL

USER_AGENT = "mabilookup-notifier/0.1"     # Discord's front door rejects the default Python agent
MAX_DETAIL = 600                           # Discord allows 2000 characters. The detail is cut first.


def tag(when, style):
    """A Discord time tag. Styles: R = "2 hours ago", f = date and time."""
    return f"<t:{int(when.timestamp())}:{style}>"


def summary(taken_at, found, missing, calls, retries, errors, published, next_at):
    """The message for a run that wrote its snapshot."""
    bad = bool(missing or errors)
    lines = [f"{'⚠️' if bad else '✅'} **mabilookup {'done with warnings' if bad else 'OK'}** · {tag(taken_at, 'f')}",
             f"{found} found · {len(missing)} not found · {calls} calls · {retries} retries · {published}"]
    if missing:
        lines.append("not found: " + ", ".join(missing))
    if errors:
        lines.append(f"{errors} unreadable rows")
    lines.append(f"next run {tag(next_at, 'R')}")
    return "\n".join(lines), False


def failure(taken_at, what, detail, next_at, written=False):
    """The message for a run that failed. It pings ALERT_MENTION."""
    head = f"{ALERT_MENTION} ❌ **mabilookup {what}** · {tag(taken_at, 'f')}".strip()
    state = "The snapshot is saved on disk but not published." if written else "Nothing was written."
    return "\n".join([head, state, f"next run {tag(next_at, 'R')}", f"```{detail[:MAX_DETAIL]}```".replace("``````", "")]), True


def send(message, ping=False, url=WEBHOOK_URL, opener=urllib.request.urlopen, log=print):
    """Post the message. `message` may be the (text, ping) pair that summary() and failure() return.
    Return True if Discord accepted it. Return False if the webhook is off or the post failed."""
    if isinstance(message, tuple):
        message, ping = message
    if not url:
        return False
    # Only a failure may ping. For everything else, @everyone in the text would stay plain text.
    allowed = {"parse": ["everyone"]} if ping else {"parse": []}
    body = json.dumps({"content": message[:2000], "allowed_mentions": allowed}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json", "User-Agent": USER_AGENT})
    try:
        with opener(req, timeout=10) as resp:
            return 200 <= resp.status < 300
    except Exception as e:                      # network, HTTP error, bad URL: all non-fatal
        log(f"webhook failed: {type(e).__name__}: {e}")
        return False
