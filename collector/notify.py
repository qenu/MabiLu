"""Tell a webhook when a run stops. Works with Discord and Slack incoming webhooks.

It never raises. A broken webhook must not hide the real error or change the exit code.
"""
import json
import urllib.request

from const import WEBHOOK_URL

USER_AGENT = "mabilookup-notifier/0.1"     # Discord's front door rejects the default Python agent
MAX_LEN = 1500


def send(message, url=WEBHOOK_URL, opener=urllib.request.urlopen, log=print):
    """Post the message. Return True if the webhook accepted it. Return False if it is off or failed."""
    if not url:
        return False
    text = message if len(message) <= MAX_LEN else message[:MAX_LEN] + "…"
    # "content" is for Discord, "text" is for Slack. Each service ignores the other key.
    body = json.dumps({"content": text, "text": text}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json", "User-Agent": USER_AGENT})
    try:
        with opener(req, timeout=10) as resp:
            return 200 <= resp.status < 300
    except Exception as e:                      # network, HTTP error, bad URL: all non-fatal
        log(f"webhook failed: {type(e).__name__}: {e}")
        return False
