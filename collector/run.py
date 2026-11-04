"""Collect one snapshot (one call per member): fetch -> append to the day file -> rebuild rollup -> git commit -> push.

    uv run collector/run.py                  # Chrome, then commit and push
    uv run collector/run.py --browser safari
    uv run collector/run.py --no-push        # commit only
    uv run collector/run.py --no-git         # write the files only
    uv run collector/run.py --dry-run        # fetch and print, write nothing
    uv run collector/run.py --rebuild-only   # rebuild docs/daily.json from the raw log, no fetch

A run that was stopped (HTTP 403/429 or a bad response) writes nothing.
"""
import argparse
import json
import sys

import snapshot
from const import DAILY_FILE, ROOT, SNAP_DIR
from gitpush import commit_and_push


def publish(message, args):
    if args.no_git:
        return
    try:
        print(commit_and_push(message, [SNAP_DIR, DAILY_FILE], push=not args.no_push))
    except RuntimeError as e:
        sys.exit(f"{e}\nThe files are saved. Fix git, then commit them by hand.")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--browser", choices=["chrome", "safari"], default="chrome")
    p.add_argument("--no-push", action="store_true", help="commit but do not push")
    p.add_argument("--no-git", action="store_true", help="write files but do not commit")
    p.add_argument("--dry-run", action="store_true", help="fetch and print, write nothing")
    p.add_argument("--rebuild-only", action="store_true", help="rebuild daily.json, no fetch")
    args = p.parse_args()

    if args.rebuild_only:
        data = snapshot.write_rollup()
        print(f"rebuilt {DAILY_FILE.relative_to(ROOT)}: {len(data['days'])} days, {data['snapshot_count']} snapshots")
        publish("rebuild daily rollup", args)
        return

    from fetcher import fetch_all  # imports selenium only when we really fetch

    taken_at = snapshot.now()
    result = fetch_all(args.browser)
    if result.stopped:
        print(f"STOP: {result.stopped}\nNothing was written.", file=sys.stderr)
        sys.exit(1)

    records = [rec for rec in result.data.values() if rec]
    missing = [name for name, rec in result.data.items() if rec is None]
    snap = snapshot.build_snapshot(records, taken_at)
    print(f"{len(result.data)} members in {result.requests} calls: "
          f"{len(records)} found, {len(missing)} not found, {result.errors} errors")
    if missing:
        print("not found:", ", ".join(missing))
    if args.dry_run:
        print(json.dumps(snap, ensure_ascii=False, indent=2))
        return

    path = snapshot.append_snapshot(snap)
    data = snapshot.write_rollup()
    print(f"appended to {path.relative_to(ROOT)} · rollup has {len(data['days'])} days")
    publish(f"snapshot {snap['taken_at']}", args)


if __name__ == "__main__":
    main()
