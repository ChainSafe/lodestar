import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BidLedger} from "../../../src/services/bidLedger.js";
import {BidStore} from "../../../src/services/bidStore.js";
import {CommitmentJournal} from "../../../src/services/commitmentJournal.js";
import {type BuiltPayload, PayloadStore} from "../../../src/services/payloadStore.js";
import {mockBuiltPayload} from "../utils/payload.js";

const directories: string[] = [];
const identity = {genesisValidatorsRoot: toRootHex(Buffer.alloc(32, 1)), pubkey: "test-builder"};
const slot = 100;

function directory(): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "builder-journal-batch-"));
  directories.push(value);
  return value;
}

function revision(value: number, blobs = 0) {
  const payload = mockBuiltPayload({slot, blockHash: Buffer.alloc(32, value), valueGwei: value});
  payload.blobsBundle = {
    blobs: Array.from({length: blobs}, (_, i) => new Uint8Array(131072).fill(i + 1)),
    commitments: Array.from({length: blobs}, (_, i) => new Uint8Array(48).fill(i + 1)),
    proofs: Array.from({length: blobs * 128}, (_, i) => new Uint8Array(48).fill((i % 251) + 1)),
  };
  const signed = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
  signed.message.slot = slot;
  signed.message.blockHash = payload.executionPayload.blockHash;
  signed.message.parentBlockHash = payload.executionPayload.parentHash;
  signed.message.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(payload.executionRequests);
  signed.message.blobKzgCommitments = payload.blobsBundle.commitments;
  signed.message.value = value;
  signed.signature.fill(value);
  return {
    signed,
    stored: {
      slot,
      parentBlockRoot: signed.message.parentBlockRoot,
      blockHash: toRootHex(signed.message.blockHash),
      payload,
    },
  };
}

function snapshot(dir: string): Map<string, Buffer> {
  return new Map(
    fs
      .readdirSync(dir)
      .filter((name) => !name.endsWith(".tmp"))
      .map((name) => [name, fs.readFileSync(path.join(dir, name))])
  );
}

function recover(dir: string) {
  const journal = new CommitmentJournal(dir, identity);
  const payloads = new PayloadStore(),
    bids = new BidStore(),
    ledger = new BidLedger();
  const count = journal.recover(slot, payloads, bids, ledger);
  return {journal, payloads, bids, count};
}

function setup(blobs = 3) {
  const primaryDirectory = directory(),
    stageDirectory = directory();
  const primary = new CommitmentJournal(primaryDirectory, identity);
  const stage = new CommitmentJournal(stageDirectory, identity, undefined, primaryDirectory);
  const previous = revision(1);
  stage.retain(previous.signed, previous.stored);
  const reveal = {
    slot,
    blockRoot: toRootHex(Buffer.alloc(32, 9)),
    blockHash: previous.stored.blockHash,
    envelopeRoot: toRootHex(Buffer.alloc(32, 10)),
  };
  stage.retainReveal(reveal);
  const previousFiles = snapshot(stageDirectory);
  const next = revision(2, blobs);
  const reference = primary.retain(next.signed, next.stored);
  if (!reference) throw Error("Missing durable reference");
  return {primaryDirectory, stageDirectory, primary, stage, previous, previousFiles, reveal, next, reference};
}

function expectPayload(actual: BuiltPayload | undefined, expected: BuiltPayload): void {
  if (!actual) throw Error("Missing recovered payload");
  expect(ssz.gloas.ExecutionPayload.equals(actual.executionPayload, expected.executionPayload)).toBe(true);
  expect(ssz.gloas.ExecutionRequests.equals(actual.executionRequests, expected.executionRequests)).toBe(true);
  expect(ssz.gloas.BlobsBundle.equals(actual.blobsBundle, expected.blobsBundle)).toBe(true);
  expect(actual.executionPayloadValue).toBe(expected.executionPayloadValue);
}

function expectPrevious(state: ReturnType<typeof setup>, dir = state.stageDirectory) {
  const recovered = recover(dir);
  expect(recovered.bids.has(state.previous.signed)).toBe(true);
  expectPayload(recovered.payloads.get(state.previous.stored.blockHash)?.payload, state.previous.stored.payload);
  for (const [name, bytes] of state.previousFiles) expect(fs.readFileSync(path.join(dir, name)), name).toEqual(bytes);
  return recovered;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) fs.rmSync(dir, {recursive: true, force: true});
});

describe("CommitmentJournal reference durability barriers", () => {
  it.each([0, 4, 8, 12, 21])("syncs %s blob links before the separate payload and bid barriers", (blobs) => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const state = setup(blobs),
      sync = fs.fsyncSync,
      events: string[][] = [];
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      sync(fd);
      if (fs.fstatSync(fd).isDirectory())
        events.push(fs.readdirSync(state.stageDirectory).filter((name) => !state.previousFiles.has(name)));
    });
    state.stage.retainReference(state.next.signed, state.reference);
    expect(events).toHaveLength(blobs ? 3 : 2);
    if (blobs) {
      expect(events[0]).toHaveLength(blobs);
      expect(events[0].every((name) => name.startsWith("blob-"))).toBe(true);
    }
    expect(events.at(-2)?.filter((name) => name.startsWith("payload-"))).toHaveLength(1);
    expect(events.at(-2)?.some((name) => name.startsWith("bid-"))).toBe(false);
    expect(events.at(-1)?.filter((name) => name.startsWith("bid-"))).toHaveLength(1);
    vi.restoreAllMocks();
    for (const [name, bytes] of snapshot(state.primaryDirectory))
      expect(fs.readFileSync(path.join(state.stageDirectory, name)), name).toEqual(bytes);
    fs.rmSync(state.primaryDirectory, {recursive: true, force: true});
    const recovered = expectPrevious(state);
    expect(recovered.bids.has(state.next.signed)).toBe(true);
    expectPayload(recovered.payloads.get(state.next.stored.blockHash)?.payload, state.next.stored.payload);
  });

  it.each([0, 1, 2, 3].flatMap((failureIndex) => [false, true].map((after) => ({failureIndex, after}))))(
    "keeps completed links reusable after source link $failureIndex fails, after=$after",
    ({failureIndex, after}) => {
      const state = setup(),
        link = fs.linkSync,
        sync = fs.fsyncSync;
      let links = 0,
        directorySyncs = 0;
      vi.spyOn(fs, "linkSync").mockImplementation((...args) => {
        if (links++ === failureIndex) {
          if (after) link(...args);
          throw Object.assign(Error("missing source"), {code: "ENOENT"});
        }
        link(...args);
      });
      vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
        sync(fd);
        if (fs.fstatSync(fd).isDirectory()) directorySyncs++;
      });
      expect(() => state.stage.retainReference(state.next.signed, state.reference)).toThrow(
        "COMMITMENT_REFERENCE_UNAVAILABLE"
      );
      expect(directorySyncs).toBe(failureIndex ? 1 : 0);
      vi.restoreAllMocks();
      expect(
        fs
          .readdirSync(state.stageDirectory)
          .filter((name) => name.startsWith("payload-") && !name.endsWith(".tmp") && !state.previousFiles.has(name))
      ).toEqual([]);
      state.stage.retain(state.next.signed, state.next.stored);
      expect(expectPrevious(state).bids.has(state.next.signed)).toBe(true);
    }
  );

  it.each([1, 2, 3, 4])(
    "poisons an uncertain failure of durability barrier %s and preserves old reveals",
    (failureIndex) => {
      const state = setup(),
        sync = fs.fsyncSync;
      let syncs = 0;
      const cause = Error("injected barrier failure");
      vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
        if (++syncs === failureIndex) throw cause;
        sync(fd);
      });
      expect(() => state.stage.retainReference(state.next.signed, state.reference)).toThrow(cause);
      vi.restoreAllMocks();
      expect(() => state.stage.retainReference(state.next.signed, state.reference)).toThrow(
        "COMMITMENT_JOURNAL_FAILED"
      );
      expect(() => state.stage.retain(state.next.signed, state.next.stored)).toThrow("COMMITMENT_JOURNAL_FAILED");
      expectPrevious(state);
    }
  );

  it.each([0, 1, 2, 3, 4].flatMap((index) => [false, true].map((after) => ({index, after}))))(
    "recovers only complete dependencies after rename crash $index, after=$after",
    ({index, after}) => {
      const state = setup(),
        rename = fs.renameSync,
        sync = fs.fsyncSync;
      let renamed = 0,
        durable = snapshot(state.stageDirectory),
        crashed = false;
      vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
        if (crashed) throw Error("crashed");
        sync(fd);
        if (fs.fstatSync(fd).isDirectory()) durable = snapshot(state.stageDirectory);
      });
      vi.spyOn(fs, "renameSync").mockImplementation((...args) => {
        if (renamed++ === index) {
          if (after) rename(...args);
          crashed = true;
          throw Error("crashed");
        }
        rename(...args);
      });
      expect(() => state.stage.retainReference(state.next.signed, state.reference)).toThrow("crashed");
      vi.restoreAllMocks();
      expect(() => state.stage.retainReference(state.next.signed, state.reference)).toThrow(
        "COMMITMENT_JOURNAL_FAILED"
      );
      const restarted = directory();
      for (const [name, bytes] of durable) fs.writeFileSync(path.join(restarted, name), bytes);
      expect(expectPrevious(state, restarted).bids.has(state.next.signed)).toBe(false);
    }
  );

  it.each([1, 2, 3, 4].flatMap((index) => [false, true].map((after) => ({index, after}))))(
    "recovers the durable prefix after barrier crash $index, after=$after",
    ({index, after}) => {
      const state = setup(),
        sync = fs.fsyncSync;
      let count = 0,
        durable = snapshot(state.stageDirectory),
        crashed = false;
      vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
        if (crashed) throw Error("crashed");
        const target = ++count === index;
        if (target && !after) {
          crashed = true;
          throw Error("crashed");
        }
        sync(fd);
        if (fs.fstatSync(fd).isDirectory()) durable = snapshot(state.stageDirectory);
        if (target) {
          crashed = true;
          throw Error("crashed");
        }
      });
      expect(() => state.stage.retainReference(state.next.signed, state.reference)).toThrow("crashed");
      vi.restoreAllMocks();
      const restarted = directory();
      for (const [name, bytes] of durable) fs.writeFileSync(path.join(restarted, name), bytes);
      expect(expectPrevious(state, restarted).bids.has(state.next.signed)).toBe(index === 4 && after);
    }
  );

  it("reuses already durable blobs without an extra group barrier", () => {
    const state = setup();
    state.stage.retainReference(state.next.signed, state.reference);
    const later = revision(3, 3);
    const reference = state.primary.retain(later.signed, later.stored);
    if (!reference) throw Error("Missing durable reference");
    const sync = fs.fsyncSync;
    let barriers = 0;
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      sync(fd);
      if (fs.fstatSync(fd).isDirectory()) barriers++;
    });
    state.stage.retainReference(later.signed, reference);
    expect(barriers).toBe(2);
    state.stage.retainReference(later.signed, reference);
    expect(barriers).toBe(2);
    vi.restoreAllMocks();
    const recovered = expectPrevious(state);
    expect(recovered.bids.has(state.next.signed)).toBe(true);
    expect(recovered.bids.has(later.signed)).toBe(true);
    expectPayload(recovered.payloads.get(later.stored.blockHash)?.payload, later.stored.payload);
  });

  it("poisons a failed partial-group barrier before snapshot fallback", () => {
    const state = setup(),
      link = fs.linkSync;
    let links = 0;
    vi.spyOn(fs, "linkSync").mockImplementation((...args) => {
      if (links++ === 2) throw Object.assign(Error("missing source"), {code: "ENOENT"});
      link(...args);
    });
    vi.spyOn(fs, "fsyncSync").mockImplementation(() => {
      throw Error("partial barrier failure");
    });
    expect(() => state.stage.retainReference(state.next.signed, state.reference)).toThrow("partial barrier failure");
    vi.restoreAllMocks();
    expect(() => state.stage.retain(state.next.signed, state.next.stored)).toThrow("COMMITMENT_JOURNAL_FAILED");
    expect(expectPrevious(state).bids.has(state.next.signed)).toBe(false);
  });

  it("deduplicates identical blob contents inside one reference group", () => {
    const state = setup();
    const next = revision(3, 1);
    const bundle = next.stored.payload.blobsBundle;
    bundle.blobs.push(bundle.blobs[0]);
    bundle.commitments.push(bundle.commitments[0]);
    bundle.proofs.push(...bundle.proofs);
    next.signed.message.blobKzgCommitments = bundle.commitments;
    const reference = state.primary.retain(next.signed, next.stored);
    if (!reference) throw Error("Missing durable reference");
    expect(reference.files[1].name).toBe(reference.files[2].name);
    const link = vi.spyOn(fs, "linkSync"),
      sync = fs.fsyncSync;
    let barriers = 0;
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      sync(fd);
      if (fs.fstatSync(fd).isDirectory()) barriers++;
    });
    state.stage.retainReference(next.signed, reference);
    expect(link).toHaveBeenCalledTimes(2);
    expect(barriers).toBe(3);
    vi.restoreAllMocks();
    fs.rmSync(state.primaryDirectory, {recursive: true, force: true});
    const recovered = expectPrevious(state);
    expect(recovered.bids.has(next.signed)).toBe(true);
    expectPayload(recovered.payloads.get(next.stored.blockHash)?.payload, next.stored.payload);
  });
});
