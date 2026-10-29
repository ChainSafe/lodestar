/**
 * Metrics example server that loads a beacon state from an ERA file and exposes
 * two HTTP endpoints:
 *
 * - `GET /metrics` — scrapes and returns Prometheus-formatted metrics.
 * - `GET /stf` — advances the beacon state by one slot, applying a block if one
 *   exists or processing an empty slot otherwise.
 *
 * On startup it initializes the NAPI bindings, loads (or creates) a PKIX pubkey
 * cache, and deserializes a beacon state from the first available ERA file.
 *
 * To check if it works:
 *
 * First download era files:
 *
 * ```sh
 * $ zig build run:download_era_files
 * ```
 *
 * Then run the server:
 *
 * ```sh
 * $ node examples/metrics.ts
 * ```
 *
 * Visit the endpoints stated above to interact with the example and check metrics.
 */
import * as fs from "node:fs";
import http from "node:http";
import { config } from "@lodestar/config/default";
import * as era from "@lodestar/era";
import bindings from "../packages/native/src/index.js";
import { getFirstEraFilePath, getEraFilePaths } from "../packages/native/test/eraFiles.ts";
import { getPubkeyCacheCapacityForState, getSerializedGenesisValidatorsRoot } from "../packages/native/test/serializedState.ts";

const PORT = 8008;
const PKIX_FILE = "./mainnet.pkix";

const hasPkix = (() => {
  try {
    fs.accessSync(PKIX_FILE);
    return true;
  } catch {
    return false;
  }
})();

console.log("Initializing metrics...");
bindings.metrics.init();

console.log("Opening era readers...");
const reader = await era.era.EraReader.open(config, getFirstEraFilePath());
const nextReader = await era.era.EraReader.open(config, getEraFilePaths()[1]);

console.log("Reading serialized state...");
const stateBytes = await reader.readSerializedState();
const requiredPubkeyCapacity = getPubkeyCacheCapacityForState(stateBytes);

let loadedPkix = false;
if (hasPkix) {
  console.log("Loading pkix cache from disk...");
  try {
    bindings.pubkeys.load(PKIX_FILE, requiredPubkeyCapacity);
    loadedPkix = true;
  } catch (error) {
    console.warn("PKIX cache is incompatible or corrupt; rebuilding it from state", error);
  }
}

let pkixNeedsSave = !loadedPkix;
if (!loadedPkix || bindings.pubkeys.capacity() < requiredPubkeyCapacity) {
  console.log("Reserving pubkey cache...");
  bindings.pubkeys.ensureCapacity(requiredPubkeyCapacity);
  pkixNeedsSave = true;
}

const cachedPubkeyCount = bindings.pubkeys.size();
console.log("Creating BeaconStateView...");
const nativeConfig = new bindings.BeaconConfig(config, getSerializedGenesisValidatorsRoot(stateBytes));
var state = bindings.BeaconStateView.createFromBytes(stateBytes, nativeConfig);
pkixNeedsSave ||= bindings.pubkeys.size() !== cachedPubkeyCount;

if (pkixNeedsSave) {
  console.log("Saving pkix cache to disk...");
  bindings.pubkeys.save(PKIX_FILE);
}

console.log(`State loaded at slot ${state.slot}, epoch ${state.epoch}`);

const server = http.createServer(async (_req, res) => {
  if (_req.url === "/metrics") {
    const metrics = bindings.metrics.scrapeMetrics();
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
    res.end(metrics);
  } else if (_req.url === "/stf") {
    try {
      const nextSlot = state.slot + 1;
      const signedBlockBytes = await nextReader.readSerializedBlock(nextSlot);

      console.time("stateTransition");
      if (signedBlockBytes) {
        state = bindings.stateTransition.stateTransition(state, signedBlockBytes as Uint8Array);
      } else {
        state = state.processSlots(nextSlot);
      }
      console.timeEnd("stateTransition");

      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(`State transitioned to slot ${state.slot}, epoch ${state.epoch}\n`);
    } catch (e) {
      console.error("stateTransition error:", e);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`Error in state transition: ${e}\n`);
    }
  } else {
    res.writeHead(404);
    res.end("Not found. Use /metrics endpoint.\n");
  }
});

server.listen(PORT, () => {
  console.log(`Metrics server listening on http://localhost:${PORT}/metrics`);
  console.log("You can scrape metrics with: curl http://localhost:8008/metrics");
  console.log("You can transition state with: curl http://localhost:8008/stf");
  console.log("Or run Prometheus with: docker run -p 9090:9090 -v $(pwd)/examples/prometheus.yml:/etc/prometheus/prometheus.yml prom/prometheus");
});
