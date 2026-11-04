"""Write the launchd job that runs the collector at RUN_TIMES. Run this on the Mac.

    uv run collector/launchd.py

It writes ~/Library/LaunchAgents/com.mabilookup.collector.plist and prints the commands to load,
test and remove the job. It does not run launchctl itself.
launchd uses the Mac's own time zone for the times. This is right when the Mac is set to Taipei time.
"""
import plistlib
import shutil
import sys
from pathlib import Path

from const import ROOT, RUN_TIMES

LABEL = "com.mabilookup.collector"
PLIST = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
LOG_FILE = ROOT / "logs" / "run.log"


def build_plist(uv, root=ROOT, times=RUN_TIMES, log_file=LOG_FILE):
    """The job file as bytes."""
    slots = []
    for t in times:
        hour, minute = map(int, t.split(":"))
        slots.append({"Hour": hour, "Minute": minute})
    return plistlib.dumps({
        "Label": LABEL,
        "ProgramArguments": [str(uv), "run", "collector/run.py"],
        "WorkingDirectory": str(root),
        "StartCalendarInterval": slots,
        "StandardOutPath": str(log_file),
        "StandardErrorPath": str(log_file),
        # launchd gives a short PATH. uv and git need to be found.
        "EnvironmentVariables": {"PATH": f"{Path(uv).parent}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"},
    })


def main():
    uv = shutil.which("uv")
    if not uv:
        sys.exit("uv was not found in PATH")
    LOG_FILE.parent.mkdir(exist_ok=True)
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    PLIST.write_bytes(build_plist(uv))
    print(f"wrote {PLIST}\nruns at {', '.join(RUN_TIMES)} (Mac time). log: {LOG_FILE}\n")
    print(f"load:    launchctl bootstrap gui/$(id -u) {PLIST}")
    print(f"test:    launchctl kickstart -k gui/$(id -u)/{LABEL}     # runs it now")
    print(f"status:  launchctl print gui/$(id -u)/{LABEL}")
    print(f"remove:  launchctl bootout gui/$(id -u)/{LABEL}")


if __name__ == "__main__":
    main()
