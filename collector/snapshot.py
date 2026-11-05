"""Format and append snapshots, and build the file the site reads.

Raw log:  docs/snapshots/<YYYY-MM-DD>.json   a list; every run appends one snapshot
Series:   docs/series.json                   EVERY snapshot in columns; the only file the site reads

A snapshot's `data` is a list with one record per member that was found:
    {"char_name", "class", "rank", "combatpower", "livingpower", "attractiveness"}
`rank` is the TOTAL ranking (ranking_type=total gives no separate rank for the 3
powers). A member who was not found has no record. The total is not stored: it is
the sum of the 3 powers, which equals the game's own total (each power rounded down).

The site shows every snapshot as it is. There is no daily-max rule.
The day of a snapshot is the first 10 characters of taken_at (Asia/Taipei, because
taken_at always carries the +08:00 offset).
"""
import json
import os
import re
from datetime import datetime
from zoneinfo import ZoneInfo

from const import POWERS, RANKING_TYPE, SERIES_FILE, SNAP_DIR, TIMEZONE, WORLD_ID

DAY_FILE = re.compile(r"^\d{4}-\d{2}-\d{2}\.json$")
RECORD_KEYS = {"char_name", "class", "rank", *POWERS}
VERSION = 3


def now():
    return datetime.now(ZoneInfo(TIMEZONE)).replace(microsecond=0)


def day_path(taken_at, snap_dir=SNAP_DIR):
    return snap_dir / f"{taken_at:%Y-%m-%d}.json"


def build_snapshot(records, taken_at):
    return {
        "version": VERSION,
        "taken_at": taken_at.isoformat(),
        "world_id": WORLD_ID,
        "ranking_type": RANKING_TYPE,
        "data": list(records),
    }


def validate(snap):
    """Raise ValueError if the snapshot shape is wrong."""
    if not isinstance(snap, dict) or snap.get("version") != VERSION or not isinstance(snap.get("data"), list):
        raise ValueError(f"snapshot must be version {VERSION} with a data list")
    datetime.fromisoformat(snap["taken_at"])
    names = set()
    for rec in snap["data"]:
        if not isinstance(rec, dict) or set(rec) != RECORD_KEYS:
            raise ValueError(f"record keys must be {sorted(RECORD_KEYS)}: {rec!r}")
        name = rec["char_name"]
        if not isinstance(name, str) or not name or not isinstance(rec["class"], str):
            raise ValueError(f"char_name and class must be text: {rec!r}")
        if name in names:
            raise ValueError(f"{name} appears twice")
        names.add(name)
        for k in ("rank", *POWERS):
            if rec[k] is not None and (not isinstance(rec[k], int) or isinstance(rec[k], bool)):
                raise ValueError(f"{name}/{k}: must be an int or null")


def _write_atomic(path, text):
    """Write to a temp file, then swap it in. A crash never leaves half a file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def read_day(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


def append_snapshot(snap, snap_dir=SNAP_DIR):
    """Append the snapshot to its day file. Return the path."""
    validate(snap)
    path = day_path(datetime.fromisoformat(snap["taken_at"]), snap_dir)
    snaps = read_day(path)
    if any(s["taken_at"] == snap["taken_at"] for s in snaps):
        raise FileExistsError(f"{snap['taken_at']} is already in {path.name}")
    snaps.append(snap)
    snaps.sort(key=lambda s: s["taken_at"])
    _write_atomic(path, json.dumps(snaps, ensure_ascii=False, indent=1) + "\n")
    return path


def latest_ranks(snap_dir=SNAP_DIR):
    """{char_name: total rank} from the newest snapshot that has records. {} if none."""
    for path in sorted((p for p in snap_dir.glob("*.json") if DAY_FILE.match(p.name)), reverse=True):
        for snap in reversed(read_day(path)):
            if snap["data"]:
                return {r["char_name"]: r["rank"] for r in snap["data"] if r["rank"] is not None}
    return {}


def load_snapshots(snap_dir=SNAP_DIR):
    files = sorted(p for p in snap_dir.glob("*.json") if DAY_FILE.match(p.name))
    return [s for p in files for s in read_day(p)]


def series_from(snaps):
    """Every snapshot in columns. times are Unix seconds. A member missing from a snapshot has null there.
    `rank` is the total rank. The total itself is not stored (the site adds the 3 powers).
    `class` is the member's newest class."""
    snaps = sorted(snaps, key=lambda s: datetime.fromisoformat(s["taken_at"]))
    members = {}
    for i, snap in enumerate(snaps):
        for rec in snap["data"]:
            m = members.setdefault(rec["char_name"], {"class": rec["class"], **{k: [None] * len(snaps) for k in ("rank", *POWERS)}})
            m["class"] = rec["class"]
            for k in ("rank", *POWERS):
                m[k][i] = rec[k]
    return {
        "version": 2,
        "snapshot_count": len(snaps),
        "updated_at": snaps[-1]["taken_at"] if snaps else None,
        "times": [int(datetime.fromisoformat(s["taken_at"]).timestamp()) for s in snaps],
        "members": members,
    }


def write_series(snap_dir=SNAP_DIR, out=SERIES_FILE, snaps=None):
    data = series_from(load_snapshots(snap_dir) if snaps is None else snaps)
    _write_atomic(out, json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    return data
