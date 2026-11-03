#!/usr/bin/env python3
"""Capture a bounded Linux perf session on the host running Lodestar.

Run with perf/tracepoint permissions:
  sudo scripts/profile-network.py PID OWNER_TID OUTPUT --seconds 120

Find OWNER_TID with `ps -T -p PID -o spid,comm` (network-owner).
Enable --network.native.traceGossip for correlated lifecycle logs and
--network.native.traceTurns for 50 ms network phase totals. All captures
use CLOCK_MONOTONIC, matching nativeMonotonicMs. CPU stacks use DWARF; keep the
matching addon and executable until `perf script`/`perf report` have symbolized
both the application and its libraries. `perf` and its viewers own CPU analysis.
Use perf's libunwind backend when decoding LLD-linked addons: libdw can misread
their load addresses and truncate call chains. Recent perf supports selecting
it with `perf script --unwind-style=libunwind` when that backend is built in.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pid", type=int)
    parser.add_argument("owner_tid", type=int)
    parser.add_argument("output", type=Path)
    parser.add_argument("--seconds", type=int, default=120, choices=range(1, 601), metavar="1..600")
    parser.add_argument("--frequency", type=int, default=199, choices=range(1, 1000), metavar="1..999")
    parser.add_argument("--port", type=int, default=9001)
    parser.add_argument("--service", default="beacon")
    args = parser.parse_args()
    task = Path(f"/proc/{args.pid}/task/{args.owner_tid}")
    task.joinpath("stat").read_text()
    args.output.mkdir(mode=0o700)
    args.output.joinpath("maps.txt").write_text(Path(f"/proc/{args.pid}/maps").read_text())
    inodes = set()
    for fd in Path(f"/proc/{args.pid}/fd").iterdir():
        try:
            link = os.readlink(fd)
        except FileNotFoundError:
            continue
        if link.startswith("socket:["):
            inodes.add(link[8:-1])
    metadata = {"pid": args.pid, "owner_tid": args.owner_tid, "seconds": args.seconds,
                "frequency": args.frequency, "stack_bytes": 61440,
                "start_unix_ns": time.time_ns(), "start_mono_ns": time.monotonic_ns()}
    metadata["perf"] = subprocess.check_output(["perf", "version"], text=True).strip()
    commands = {
        "cpu": ["perf", "record", "--clockid", "mono", "-F", str(args.frequency), "-t", str(args.owner_tid),
                "--call-graph", f"dwarf,{metadata['stack_bytes']}", "-o", str(args.output / "cpu.data"), "--", "sleep", str(args.seconds)],
        "sched": ["perf", "record", "--clockid", "mono", "-a", "-e", "sched:sched_switch", "--filter",
                  f"prev_pid == {args.owner_tid} || next_pid == {args.owner_tid}",
                  "-e", "sched:sched_waking", "--filter", f"pid == {args.owner_tid}",
                  "-o", str(args.output / "sched.data"), "--", "sleep", str(args.seconds)],
    }
    processes = []
    logs = []
    try:
        for name, command in commands.items():
            log = args.output.joinpath(f"{name}.log").open("w")
            logs.append(log)
            processes.append(subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT))
        start = time.monotonic()
        with args.output.joinpath("sockets.jsonl").open("w") as samples:
            for index in range(args.seconds * 20):
                row = {"mono_ns": time.monotonic_ns(), "unix_ns": time.time_ns(),
                       "schedstat": list(map(int, task.joinpath("schedstat").read_text().split())), "sockets": []}
                for family in ("udp", "udp6"):
                    for line in Path(f"/proc/{args.pid}/net/{family}").read_text().splitlines()[1:]:
                        fields = line.split()
                        if fields[9] not in inodes or int(fields[1].split(":")[1], 16) != args.port:
                            continue
                        tx, rx = (int(value, 16) for value in fields[4].split(":"))
                        row["sockets"].append({"family": family, "inode": fields[9], "rx": rx, "tx": tx,
                                               "drops": int(fields[-1])})
                samples.write(json.dumps(row) + "\n")
                if any(proc.poll() not in (None, 0) for proc in processes):
                    raise RuntimeError("perf failed; inspect cpu.log and sched.log")
                time.sleep(max(0, start + (index + 1) / 20 - time.monotonic()))
        for proc in processes:
            if proc.wait(timeout=30) != 0:
                raise RuntimeError("perf failed; inspect capture logs")
    finally:
        for proc in processes:
            if proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=10)
        for log in logs:
            log.close()
        metadata.update(end_unix_ns=time.time_ns(), end_mono_ns=time.monotonic_ns())
        args.output.joinpath("metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    with args.output.joinpath("journal.jsonl").open("w") as logs:
        subprocess.run(["journalctl", "--no-pager", "-u", args.service, "-o", "json",
                        "--since", f"@{metadata['start_unix_ns'] // 1_000_000_000}",
                        "--until", f"@{metadata['end_unix_ns'] // 1_000_000_000 + 1}"],
                       stdout=logs, check=True, timeout=30)
    print(args.output)


if __name__ == "__main__":
    main()
