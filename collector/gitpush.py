"""Commit (and push) snapshot files. Only the paths we pass are staged."""
import subprocess

from const import ROOT


def git(*cmd, root=ROOT):
    return subprocess.run(["git", *cmd], cwd=root, check=True, text=True, capture_output=True)


def commit_and_push(message, paths, push=True, root=ROOT):
    """Return "nothing to commit", "committed" or "pushed". Raise RuntimeError on a git error."""
    paths = [str(p) for p in paths]
    try:
        git("add", "--", *paths, root=root)
        staged = subprocess.run(
            ["git", "diff", "--cached", "--quiet", "--", *paths], cwd=root
        ).returncode
        if staged == 0:
            return "nothing to commit"
        git("commit", "-m", message, "--", *paths, root=root)
        if not push:
            return "committed"
        git("push", root=root)
        return "pushed"
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"git {' '.join(e.cmd[1:3])} failed: {(e.stderr or '').strip()}")
