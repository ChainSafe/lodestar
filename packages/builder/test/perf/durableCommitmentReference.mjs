// Run after the builder package build: node packages/builder/test/perf/durableCommitmentReference.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {ssz} from "../../../types/lib/index.js";
import {AsyncCommitmentJournal} from "../../lib/services/asyncCommitmentJournal.js";
const rows = [];
const identity = {genesisValidatorsRoot: "0x" + "11".repeat(32), pubkey: "benchmark"};
for (let pair = 0; pair < 3; pair++)
  for (const referenceMode of pair % 2 ? [true, false] : [false, true]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zbuilder-ref-bench-"));
    let primary, stage;
    try {
      primary = await AsyncCommitmentJournal.start({directory: path.join(root, "primary"), identity});
      stage = await AsyncCommitmentJournal.start({
        directory: path.join(root, "stage"),
        identity,
        sharedPayloadDirectory: path.join(root, "primary"),
      });
      const times = [];
      for (let i = 1; i <= 24; i++) {
        const payload = ssz.gloas.ExecutionPayload.defaultValue();
        payload.slotNumber = 100;
        payload.blockHash = Buffer.alloc(32);
        payload.blockHash.writeUInt32BE(i, 28);
        payload.transactions = Array.from({length: 200}, (_, j) => new Uint8Array(400).fill(j));
        payload.blockAccessList = new Uint8Array(100000).fill(1);
        const blobsBundle = {
          blobs: Array.from({length: 8}, (_, j) => new Uint8Array(131072).fill(j)),
          commitments: Array.from({length: 8}, (_, j) => new Uint8Array(48).fill(j)),
          proofs: Array.from({length: 1024}, (_, j) => new Uint8Array(48).fill(j)),
        };
        const bid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
        bid.message.slot = 100;
        bid.message.blockHash = payload.blockHash;
        bid.message.blobKzgCommitments = blobsBundle.commitments;
        const stored = {
          slot: 100,
          blockHash: "0x" + Buffer.from(payload.blockHash).toString("hex"),
          parentBlockRoot: bid.message.parentBlockRoot,
          payload: {
            sourceId: "benchmark",
            executionPayload: payload,
            executionPayloadValue: BigInt(i),
            executionRequests: ssz.gloas.ExecutionRequests.defaultValue(),
            blobsBundle,
          },
        };
        await primary.retain(bid, stored);
        const signed = structuredClone(bid);
        signed.message.builderIndex = 2;
        const start = performance.now();
        if (referenceMode) await stage.retainShared(signed, stored, primary.getReference(stored));
        else await stage.retain(signed, stored);
        times.push(performance.now() - start);
      }
      const sorted = [...times].sort((a, b) => a - b);
      rows.push({pair, referenceMode, n: times.length, p50: sorted[12], p95: sorted[22], times});
    } finally {
      await stage?.close();
      await primary?.close();
      fs.rmSync(root, {recursive: true, force: true});
    }
  }
console.log(
  JSON.stringify(
    {workload: {transactions: 200, txBytes: 400, accessListBytes: 100000, blobs: 8, revisions: 24}, rows},
    null,
    2
  )
);
