"""When does the next run start? Used for the "next run" line in the Discord message."""
from datetime import timedelta
from zoneinfo import ZoneInfo

from const import RUN_TIMES, TIMEZONE


def next_run(now, times=RUN_TIMES):
    """The first run time after `now` (a datetime with a time zone), in Asia/Taipei."""
    now = now.astimezone(ZoneInfo(TIMEZONE))
    for day in (0, 1):
        for t in sorted(times):
            hour, minute = map(int, t.split(":"))
            cand = (now + timedelta(days=day)).replace(hour=hour, minute=minute, second=0, microsecond=0)
            if cand > now:
                return cand
    raise ValueError("RUN_TIMES is empty")
