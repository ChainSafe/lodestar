import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";

// Real compiled worker protocol, temporary journals, no network or transaction send.
const root = process.argv[2];
if (!root) throw Error("Usage: node commitmentAdmission.mjs <compiled repository>");
const load = (name) => import(pathToFileURL(path.join(root, "packages/builder/lib/services", `${name}.js`)));
const {AsyncCommitmentJournal} = await load("asyncCommitmentJournal");
const {CommitmentJournal} = await load("commitmentJournal");
const {BidLedger} = await load("bidLedger");
const {BidStore} = await load("bidStore");
const {PayloadStore} = await load("payloadStore");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "commitment-admission-"));
const identity = {genesisValidatorsRoot: toRootHex(Buffer.alloc(32)), pubkey: "fixture"};
const orderId = (i) => `0x${i.toString(16).padStart(64, "0")}`;
function fixture(slot, member, hashByte = 1) {
  const executionPayload = ssz.gloas.ExecutionPayload.defaultValue();
  executionPayload.slotNumber = slot;
  executionPayload.blockHash.fill(hashByte);
  const executionRequests = ssz.gloas.ExecutionRequests.defaultValue();
  const bid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
  bid.message.slot = slot;
  bid.message.blockHash = executionPayload.blockHash;
  bid.message.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(executionRequests);
  const stored = {slot, blockHash: toRootHex(executionPayload.blockHash), parentBlockRoot: bid.message.parentBlockRoot,
    payload: {sourceId: "fixture", executionPayload, executionRequests, executionPayloadValue: 0n,
      blobsBundle: {blobs: [], commitments: [], proofs: []},
      orderMetadata: {version: 1, orderIds: [orderId(member)], doNotOfferBefore: 0}}};
  return {bid, stored};
}
let worker;
try {
  const first = new CommitmentJournal(directory, identity);
  for (let i = 0; i < 256; i++) {
    const f = fixture(100, i);
    first.retain(f.bid, f.stored);
  }
  worker = await AsyncCommitmentJournal.start({directory, identity});
  const before = fs.readdirSync(directory).sort();
  const rejected = fixture(100, 256, 2);
  await assert.rejects(worker.retain(rejected.bid, rejected.stored),
    (error) => error.message === "COMMITMENT_SLOT_ADMISSION_LIMIT" && error.uncertain === false);
  assert.equal(worker.isHealthy(), true);
  assert.deepEqual(fs.readdirSync(directory).sort(), before);
  const retry = fixture(100, 0);
  await worker.retain(retry.bid, retry.stored);
  const next = fixture(101, 256, 3);
  await worker.retain(next.bid, next.stored);
  const exposure = await worker.queryExposure(orderId(256), Date.now());
  assert.equal(exposure.coverageComplete, true);
  assert.equal(exposure.commitmentCount, 1);
  assert.equal(worker.isHealthy(), true);
  await worker.close();
  worker = undefined;
  const restored = new CommitmentJournal(directory, identity);
  const payloads = new PayloadStore();
  const bids = new BidStore();
  const ledger = new BidLedger();
  assert.equal(restored.recover(101, payloads, bids, ledger), 257);
  assert.equal(ledger.getRevisionCount(100), 1);
  assert.equal(payloads.has(retry.stored.blockHash), true);
  process.stdout.write(`${JSON.stringify({pass: true, admissions: 257, sameSignatureAdmissions: 256,
    capRefusalDefinite: true, capWrites: 0, nextSlotHealthy: true, historicalRevealRecovered: true})}\n`);
} finally {
  await worker?.close();
  fs.rmSync(directory, {recursive: true, force: true});
}
