import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, expect, it, vi} from "vitest";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BidLedger} from "../../../src/services/bidLedger.js";
import {BidStore} from "../../../src/services/bidStore.js";
import {CommitmentJournal} from "../../../src/services/commitmentJournal.js";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {mockBuiltPayload} from "../utils/payload.js";

vi.mock("../../../src/services/commitmentLimits.js", async (original) => ({
  ...(await original<typeof import("../../../src/services/commitmentLimits.js")>()),
  MAX_COMMITMENT_JOURNAL_FILES: 10,
  RESERVED_REVEAL_FILES: 4,
}));

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) fs.rmSync(dir, {recursive: true, force: true});
});

it("accounts for partial blob links at capacity and preserves reveal headroom", () => {
  const identity = {genesisValidatorsRoot: toRootHex(Buffer.alloc(32, 1)), pubkey: "batch-capacity-test"};
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "journal-batch-source-"));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "journal-batch-target-"));
  directories.push(source, target);
  const primary = new CommitmentJournal(source, identity);
  const stage = new CommitmentJournal(target, identity, undefined, source);
  const slot = 100;
  const payload = mockBuiltPayload({slot});
  const previous = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
  previous.message.slot = slot;
  previous.message.blockHash = payload.executionPayload.blockHash;
  previous.message.parentBlockHash = payload.executionPayload.parentHash;
  previous.message.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(payload.executionRequests);
  const stored = {
    slot,
    blockHash: toRootHex(previous.message.blockHash),
    parentBlockRoot: previous.message.parentBlockRoot,
    payload,
  };
  stage.retain(previous, stored);
  const previousRevision = structuredClone(previous);
  previousRevision.message.value = 1;
  stage.retain(previousRevision, stored);
  const next = structuredClone(previous),
    nextStored = structuredClone(stored);
  next.message.blockHash = Buffer.alloc(32, 3);
  nextStored.payload.executionPayload.blockHash = next.message.blockHash;
  nextStored.blockHash = toRootHex(next.message.blockHash);
  nextStored.payload.blobsBundle = {
    blobs: [1, 2, 3].map((value) => new Uint8Array(131072).fill(value)),
    commitments: [1, 2, 3].map((value) => new Uint8Array(48).fill(value)),
    proofs: Array.from({length: 384}, (_, i) => new Uint8Array(48).fill(i % 251)),
  };
  next.message.blobKzgCommitments = nextStored.payload.blobsBundle.commitments;
  const ref = primary.retain(next, nextStored);
  if (!ref) throw Error("Missing durable reference");
  const sync = fs.fsyncSync;
  let barriers = 0;
  vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
    sync(fd);
    if (fs.fstatSync(fd).isDirectory()) barriers++;
  });
  expect(() => stage.retainReference(next, ref)).toThrow("COMMITMENT_JOURNAL_CAPACITY");
  expect(barriers).toBe(1);
  expect(fs.readdirSync(target).filter((name) => name.startsWith("blob-"))).toHaveLength(2);
  expect(() => stage.retainReference(next, ref)).toThrow("COMMITMENT_JOURNAL_CAPACITY");
  expect(barriers).toBe(1);
  const reveal = {
    slot,
    blockRoot: toRootHex(Buffer.alloc(32, 4)),
    blockHash: stored.blockHash,
    envelopeRoot: toRootHex(Buffer.alloc(32, 5)),
  };
  stage.retainReveal(reveal);
  vi.restoreAllMocks();
  const bids = new BidStore(),
    ledger = new BidLedger();
  expect(new CommitmentJournal(target, identity).recover(slot, new PayloadStore(), bids, ledger)).toBe(2);
  expect(bids.has(previous)).toBe(true);
  expect(bids.has(previousRevision)).toBe(true);
  expect(bids.has(next)).toBe(false);
  expect(ledger.canReveal(reveal.blockRoot, reveal.blockHash, reveal.envelopeRoot)).toBe(true);
});
