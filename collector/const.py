import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SNAP_DIR = ROOT / "docs" / "snapshots"   # raw log: one file per day
SERIES_FILE = ROOT / "docs" / "series.json"  # every snapshot, compact: the only file the site reads
PROFILE_DIR = ROOT / ".chrome-profile"

SITE_URL = "https://tw.nexon.com/mabinogimobile/"
API_URL = "https://tw.nexon.com/mabinogimobile/api/content/game/role-ranking/"
WORLD_ID = "2"
DELAY_SEC = 3

# A request that fails (network error, HTTP 403/429/5xx, a page that is not the API's JSON) is
# tried again up to RETRIES times, with these waits in seconds. After that the run stops.
RETRIES = 3
RETRY_WAIT_SEC = (15, 45, 120)


def _read_webhook():
    """The webhook URL is a secret: anyone who has it can post to your channel.
    This repo is public, so do NOT write it in this file. Use one of these:
      - the environment variable MABILOOKUP_WEBHOOK
      - a file named webhook.url in the project root (git-ignored), holding only the URL
    Empty means off."""
    url = os.environ.get("MABILOOKUP_WEBHOOK", "").strip()
    if not url:
        try:
            url = (ROOT / "webhook.url").read_text(encoding="utf-8").strip()
        except OSError:
            url = ""
    return url


WEBHOOK_URL = _read_webhook()     # a Discord incoming webhook. Every run posts a summary or an alert.
ALERT_MENTION = "@everyone"       # pinged on a failed run. "@here" pings only members who are online. "" = no ping.

# Run times (24-hour, HH:MM). collector/launchd.py builds the schedule from these,
# and the "next run" line in the Discord message uses them.
RUN_TIMES = ("02:00", "08:00", "14:00", "23:00")

# Folder and file names use this time zone. taken_at keeps the UTC offset.
TIMEZONE = "Asia/Taipei"

# One call with ranking_type=total returns the total rank, the total value and all 3 powers.
RANKING_TYPE = "total"
POWERS = ("combatpower", "livingpower", "attractiveness")
# The total is not stored: it is the sum of the 3 powers.

PLAYERS_FILE = ROOT / "player.json"     # the guild members: a JSON list of in-game char_name

CLASS_HASH_TO_NAME = {
    "33220478": "見習戰士",
    "204163716": "修道士",
    "323147599": "治癒師",
    "413919140": "舞者",
    "589957914": "電擊術士",
    "956241373": "樂師",
    "958792831": "劍術士",
    "995607437": "弓手",
    "1262278397": "冰霜術士",
    "1285686831": "戰士",
    "1319349030": "吟遊詩人",
    "1443648579": "盜賊",
    "1452582855": "火焰術士",
    "1468161402": "弩手",
    "1497581170": "見習魔法師",
    "1504253211": "祭司",
    "1600175531": "見習弓手",
    "1790463651": "格鬥家",
    "1795991954": "見習治癒師",
    "1876490724": "魔法師",
    "1901800669": "長弓兵",
    "1957076952": "雙刀客",
    "2017961297": "見習吟遊詩人",
    "2058842272": "見習盜賊",
    "2077040965": "大劍戰士",
}
