#!/usr/bin/env python3
"""Run alternating, isolated journal profiles on one supplied filesystem."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time


def inventory(root):
    files = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"Symlink in artifact tree: {path}")
        if path.is_file():
            files[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return files


def map_hash(files):
    return hashlib.sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, help="Locally present sha256 image ID")
    parser.add_argument("--baseline-builder", required=True, type=Path)
    parser.add_argument("--candidate-module", required=True, type=Path)
    parser.add_argument("--scratch-root", required=True, type=Path, help="Existing empty, dedicated directory on the filesystem being measured")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", args.image):
        parser.error("Use an immutable local image ID")
    source = args.baseline_builder.resolve(strict=True)
    candidate = args.candidate_module.resolve(strict=True)
    candidate_map = candidate.with_suffix(".js.map")
    scratch = args.scratch_root.resolve(strict=True)
    if any(scratch.iterdir()):
        parser.error("The dedicated scratch root must be empty")
    tools = Path(__file__).resolve().parent
    originals = inventory(source)
    replacements = {"services/commitmentJournal.js": hashlib.sha256(candidate.read_bytes()).hexdigest()}
    if candidate_map.exists():
        replacements["services/commitmentJournal.js.map"] = hashlib.sha256(candidate_map.read_bytes()).hexdigest()
    if not replacements.keys() <= originals.keys():
        parser.error("Candidate module is not present in the baseline artifact tree")
    baseline_map = dict(originals)
    candidate_files = {**baseline_map, **replacements}
    tool_hashes = {name: hashlib.sha256((tools / name).read_bytes()).hexdigest() for name in ["run.py", "measure.mjs", "profile-preload.mjs"]}
    report = {
        "startedAtUnix": time.time(), "image": args.image,
        "filesystemDevice": scratch.stat().st_dev,
        "filesystem": subprocess.check_output(["findmnt", "-J", "-T", str(scratch), "-o", "TARGET,SOURCE,FSTYPE"], text=True),
        "baselineCompiledFiles": baseline_map, "candidateCompiledFiles": candidate_files,
        "baselineMapSha256": map_hash(baseline_map), "candidateMapSha256": map_hash(candidate_files),
        "toolSha256": tool_hashes, "limits": {"cpus": 1, "memoryMiB": 512, "network": "none", "maxUniqueBytesPerRun": 32 * 1024 * 1024},
        "runs": [],
    }
    for index, variant in enumerate(["baseline", "batched", "batched", "baseline"]):
        workspace = Path(tempfile.mkdtemp(prefix="journal-", dir=scratch))
        command = ["docker", "run", "--rm", "--pull=never", "--network=none", "--read-only", "--cpus=1", "--memory=512m", "--pids-limit=128", "--user", f"{os.getuid()}:{os.getgid()}", "--entrypoint", "node"]
        mounts = [(tools, "/tools", True), (workspace, "/scratch", False), (source, "/usr/app/packages/builder/lib", True)]
        if variant == "batched":
            mounts.append((candidate, "/usr/app/packages/builder/lib/services/commitmentJournal.js", True))
            if candidate_map.exists():
                mounts.append((candidate_map, "/usr/app/packages/builder/lib/services/commitmentJournal.js.map", True))
        for path, destination, readonly in mounts:
            command.extend(["--mount", f"type=bind,src={path},dst={destination}" + (",readonly" if readonly else "")])
        command.extend([args.image, "/tools/measure.mjs", "/usr/app", "/scratch", variant])
        started = time.time()
        try:
            result = subprocess.run(command, text=True, capture_output=True, timeout=120)
            row = {"index": index, "variant": variant, "startedAtUnix": started, "finishedAtUnix": time.time(), "exitCode": result.returncode}
            if result.returncode:
                row["stderr"] = result.stderr[-4000:]
            else:
                row["measurements"] = json.loads(result.stdout)
            report["runs"].append(row)
            args.output.write_text(json.dumps(report, indent=2) + "\n")
            if result.returncode:
                raise RuntimeError(f"Profile {index} failed; see {args.output}")
        finally:
            shutil.rmtree(workspace)
    assert inventory(source) == originals, "Baseline artifacts changed during the benchmark"
    assert hashlib.sha256(candidate.read_bytes()).hexdigest() == replacements["services/commitmentJournal.js"]
    if candidate_map.exists():
        assert hashlib.sha256(candidate_map.read_bytes()).hexdigest() == replacements["services/commitmentJournal.js.map"]
    assert all(run["measurements"]["payloadHashes"] == report["runs"][0]["measurements"]["payloadHashes"] for run in report["runs"])
    report.update(finishedAtUnix=time.time(), artifactHashesUnchanged=True, allRecoveredPayloadsByteEqual=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), "runs": len(report["runs"]), "allRecoveredPayloadsByteEqual": True}))


if __name__ == "__main__":
    main()
