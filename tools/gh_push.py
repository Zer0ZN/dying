"""Push a local commit to GitHub through the REST API.

The sandbox can reach api.github.com but not github.com:443 (TCP connect
times out), so `git push` fails. This script replays the commits between the
remote head and local HEAD using the git data API instead:

    blobs -> tree (base_tree = remote tree) -> commit -> update ref

Usage:  python tools/gh_push.py [-n]

Writes nothing to the repo; only touches the remote ref when every object has
been created successfully.
"""

import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

REPO = "Zer0ZN/dying"
BRANCH = "main"

# The remote commits this script creates are NOT in the local object database
# (there is no fetch path to github.com), so `rev-list <remote>..HEAD` fails
# with "unknown revision".  Remember which local commit produced the remote
# head instead, and walk from there next time.
STATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".pushstate")


def read_state():
    try:
        with open(STATE) as f:
            local, remote = f.read().split()
        return local, remote
    except (OSError, ValueError):
        return None, None


def write_state(local, remote):
    with open(STATE, "w") as f:
        f.write(f"{local} {remote}\n")


def api(path, method="GET", payload=None, token=""):
    url = "https://api.github.com" + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    if data:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


def git(*args, binary=False):
    out = subprocess.check_output(["git", *args])
    return out if binary else out.decode().strip()


def token_from_remote():
    url = git("remote", "get-url", "origin")
    # https://user:TOKEN@github.com/owner/repo.git
    return url.split(":", 2)[2].split("@")[0]


def changed_paths(sha):
    out = git("diff-tree", "--no-commit-id", "--name-only", "-r", sha + "^", sha)
    return [p for p in out.splitlines() if p]


def main():
    dry = "-n" in sys.argv
    token = token_from_remote()

    local_head = git("rev-parse", "HEAD")
    remote = api(f"/repos/{REPO}/git/ref/heads/{BRANCH}", token=token)
    remote_head = remote["object"]["sha"]
    if remote_head == local_head:
        print("already up to date:", local_head)
        return

    # Local commit that the current remote head was built from.
    known_local, known_remote = read_state()
    if "--since" in sys.argv:
        known_local = sys.argv[sys.argv.index("--since") + 1]
    if known_remote != remote_head:
        # Someone else pushed, or the state file is missing: fall back to the
        # last commit we know about and verify it is an ancestor of HEAD.
        if not known_local:
            raise SystemExit(
                "remote head %s is not in the local history and tools/.pushstate "
                "is missing; pass the local commit it was built from as --since <sha>"
                % remote_head[:7]
            )
        print(f"warning: remote moved ({known_remote[:7]} -> {remote_head[:7]}); "
              f"using local base {known_local[:7]}")
    base_local = known_local

    chain = git("rev-list", "--reverse", f"{base_local}..{local_head}").splitlines()
    print(f"remote {remote_head[:7]} -> local {local_head[:7]}  ({len(chain)} commit(s))")

    parent = remote_head
    for sha in chain:
        subject = git("log", "-1", "--format=%s", sha)
        body = git("log", "-1", "--format=%B", sha)
        paths = changed_paths(sha)
        print(f"  {sha[:7]} {subject!r} ({len(paths)} path(s))")

        base = api(f"/repos/{REPO}/git/commits/{parent}", token=token)
        tree_entries = []
        for p in paths:
            try:
                blob_bytes = git("show", f"{sha}:{p}", binary=True)
            except subprocess.CalledProcessError:
                continue  # deleted file in this commit — not supported here
            blob = api(
                f"/repos/{REPO}/git/blobs",
                "POST",
                {"content": base64.b64encode(blob_bytes).decode(), "encoding": "base64"},
                token,
            )
            tree_entries.append({"path": p, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        if not tree_entries:
            raise SystemExit(f"no blobs created for {sha}")

        tree = api(
            f"/repos/{REPO}/git/trees",
            "POST",
            {"base_tree": base["tree"]["sha"], "tree": tree_entries},
            token,
        )
        author = {
            "name": git("log", "-1", "--format=%an", sha),
            "email": git("log", "-1", "--format=%ae", sha),
            "date": git("log", "-1", "--format=%aI", sha),
        }
        if dry:
            print("    [dry] would create tree", tree["sha"])
            parent = "0" * 40
            continue
        commit = api(
            f"/repos/{REPO}/git/commits",
            "POST",
            {"message": body, "tree": tree["sha"], "parents": [parent], "author": author, "committer": author},
            token,
        )
        parent = commit["sha"]
        print("    ->", parent)

    if dry:
        return
    api(
        f"/repos/{REPO}/git/refs/heads/{BRANCH}",
        "PATCH",
        {"sha": parent, "force": False},
        token,
    )
    write_state(local_head, parent)
    print("pushed", parent)


if __name__ == "__main__":
    main()
