from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SNAP_DIR = ROOT / "docs" / "snapshots"   # raw log: one file per day
DAILY_FILE = ROOT / "docs" / "daily.json"  # rollup the site reads
PROFILE_DIR = ROOT / ".chrome-profile"

SITE_URL = "https://tw.nexon.com/mabinogimobile/"
API_URL = "https://tw.nexon.com/mabinogimobile/api/content/game/role-ranking/"
WORLD_ID = "2"
DELAY_SEC = 3

# Folder and file names use this time zone. taken_at keeps the UTC offset.
TIMEZONE = "Asia/Taipei"

# One call with ranking_type=total returns the total rank, the total value and all 3 powers.
RANKING_TYPE = "total"
POWERS = ("combatpower", "livingpower", "attractiveness")
METRICS = (*POWERS, "total")      # "total" is not stored: it is the sum of the 3 powers

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
