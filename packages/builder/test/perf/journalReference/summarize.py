#!/usr/bin/env python3
"""Summarize paired journal profiles without treating them as network-delivery evidence."""
import argparse
import json
from pathlib import Path
import statistics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", type=Path, nargs="+")
    args = parser.parse_args()
    summary = []
    for path in args.reports:
        report = json.loads(path.read_text())
        groups = []
        for blobs in [0, 4, 8, 12, 21]:
            for revision in [0, 1]:
                entry = {"blobs": blobs, "revision": revision}
                for variant in ["baseline", "batched"]:
                    rows = [row for run in report["runs"] if run["variant"] == variant for row in run["measurements"]["rows"] if row["blobs"] == blobs and row["revision"] == revision]
                    entry[variant] = {"samples": len(rows), "prepareMedianMs": statistics.median(row["prepareMs"] for row in rows), "prepareMaxMs": max(row["prepareMs"] for row in rows), "retainMedianMs": statistics.median(row["retainSharedMs"] for row in rows), "directorySyncMedianMs": statistics.median(row["phases"]["directorySync"]["elapsedMs"] for row in rows), "directorySyncCounts": sorted({row["phases"]["directorySync"]["count"] for row in rows}), "fileSyncCounts": sorted({row["phases"]["fileSync"]["count"] for row in rows}), "dispatchMedianMs": statistics.median(row["enqueueToWorkerMs"] for row in rows), "signMedianMs": statistics.median(row["signMs"] for row in rows), "throttledOperations": sum(row["cpuDelta"]["nr_throttled"] > 0 for row in rows)}
                groups.append(entry)
        summary.append({"report": str(path), "image": report["image"], "filesystemDevice": report["filesystemDevice"], "baselineMapSha256": report["baselineMapSha256"], "candidateMapSha256": report["candidateMapSha256"], "allRecoveredPayloadsByteEqual": report["allRecoveredPayloadsByteEqual"], "groups": groups})
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
