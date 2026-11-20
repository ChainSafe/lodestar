"""Capture one finalized Gloas epoch from a trusted local Plataberget beacon API.

GET requests only. The companion replay checks roots and signatures offline.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("output", type=Path)
parser.add_argument("--beacon", default="http://127.0.0.1:9596")
args = parser.parse_args()


def get(path, *, binary=False, limit=2 * 1024**2):
    req = urllib.request.Request(args.beacon.rstrip("/") + path,
                                 headers={"Accept": "application/octet-stream" if binary else "application/json"})
    with urllib.request.urlopen(req, timeout=30) as response:
        data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError("Response exceeds fixture size limit")
        if binary:
            if response.headers.get("Eth-Consensus-Version") != "gloas":
                raise ValueError("Expected a Gloas response")
            return data
        return json.loads(data)


header = get("/eth/v1/beacon/headers/finalized")["data"]
slot = int(header["header"]["message"]["slot"])
state = get("/eth/v2/debug/beacon/states/" + header["header"]["message"]["state_root"],
            binary=True, limit=128 * 1024**2)
meta = {"header": header, "version": "gloas", "config": get("/eth/v1/config/spec"),
        "genesis": get("/eth/v1/beacon/genesis"), "bytes": len(state)}
blocks, missed = [], []
for target in range(slot + 1, slot + 33):
    try:
        raw = get("/eth/v2/beacon/blocks/" + str(target), binary=True)
        blocks.append({"slot": target, "ssz": base64.b64encode(raw).decode()})
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        missed.append(target)
if not blocks:
    raise ValueError("No successor blocks available")
args.output.mkdir(parents=True, exist_ok=False)
files = {"plataberget-state.ssz": state,
         "plataberget-state.json": json.dumps(meta).encode(),
         "plataberget-blocks.json": json.dumps({"blocks": blocks, "missed": missed,
                                               "from": slot + 1, "to": slot + 32}).encode()}
for name, data in files.items():
    (args.output / name).write_bytes(data)
print(json.dumps({"slot": slot, "blocks": len(blocks), "missedSlots": missed,
                  "sha256": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}))
