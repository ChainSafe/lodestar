#!/usr/bin/env python3
import json
import sys
import urllib.request


def get(base, path):
    with urllib.request.urlopen(base.rstrip("/") + path, timeout=10) as response:
        return json.load(response)


collector, *beacons = sys.argv[1:]
assert beacons, "Pass a collector URL followed by beacon API URLs"
report = {"beacons": [], "sources": []}
for beacon in beacons:
    syncing = get(beacon, "/eth/v1/node/syncing")["data"]
    finalized = get(beacon, "/eth/v1/beacon/states/head/finality_checkpoints")["data"]["finalized"]
    assert not syncing["is_syncing"] and not syncing["is_optimistic"] and not syncing["el_offline"], beacon
    assert int(finalized["epoch"]) > 0, f"{beacon}: waiting for finality"
    report["beacons"].append({"url": beacon, **syncing, "finalized": finalized})
assert len({b["finalized"]["root"] for b in report["beacons"]}) == 1, "Finalized roots differ"
sources = get(collector, "/api/sources")["sources"]
assert len(sources) == len(beacons), "Missing Xray source"
for source in sources:
    source_id = source["source_id"]
    assert source["connected"], source_id
    slots = get(collector, f"/api/slots?source={source_id}")["slots"]
    details = [get(collector, f"/api/slots/{slot['slot']}?source={source_id}") for slot in slots]
    rows = [row for detail in details for row in detail["breakdown"]]
    assert not any(row["message_kind"] in ("decode_error", "capture_incomplete") for row in rows), source_id
    topics = {row["topic"] for row in rows if row["message_kind"] == "PUBLISH"}
    assert "beacon_block" in topics and "beacon_aggregate_and_proof" in topics, source_id
    assert any(topic.startswith("beacon_attestation_") for topic in topics), source_id
    assert any(row["message_kind"] == "raw" and "/req/" in row["protocol"] for row in rows), source_id
    report["sources"].append({
        "source_id": source_id,
        "client_name": source["client_name"],
        "slots": len(slots),
        "publish_messages": sum(row["msg_count"] for row in rows if row["message_kind"] == "PUBLISH"),
        "bytes": sum(detail["summary"]["bytes_in"] + detail["summary"]["bytes_out"] for detail in details),
        "decode_errors": 0,
        "incomplete_captures": 0,
    })
print(json.dumps(report, indent=2))
