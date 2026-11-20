import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {SerializedList} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BidLedger} from "../../../src/services/bidLedger.js";
import {BidStore} from "../../../src/services/bidStore.js";
import {CommitmentJournal} from "../../../src/services/commitmentJournal.js";
import {BID_HISTORY_SLOTS} from "../../../src/services/commitmentLimits.js";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {mockBuiltPayload} from "../utils/payload.js";

// Exercise the real filesystem writer at small quotas rather than allocating
// hundreds of MiB or thousands of fsynced files in a unit test.
vi.mock("../../../src/services/commitmentLimits.js", async (original) => ({
  ...(await original<typeof import("../../../src/services/commitmentLimits.js")>()),
  MAX_COMMITMENT_JOURNAL_BYTES: 65536,
  MAX_COMMITMENT_JOURNAL_FILES: 12,
  RESERVED_REVEAL_FILES: 4,
  RESERVED_REVEAL_BYTES: 4096,
}));

const directories: string[] = [];
const identity = {genesisValidatorsRoot: toRootHex(Buffer.alloc(32, 1)), pubkey: "capacity-test"};
const slot = 100;
function directory(): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "builder-journal-capacity-"));
  directories.push(value);
  return value;
}

function revision(txBytes = 0) {
  const payload = mockBuiltPayload({slot, blockHash: Buffer.alloc(32, 2)});
  payload.executionPayload.transactions = SerializedList.fromArray(txBytes ? [Buffer.alloc(txBytes)] : []);
  const signed = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
  signed.message.slot = slot;
  signed.message.blockHash = payload.executionPayload.blockHash;
  signed.message.parentBlockHash = payload.executionPayload.parentHash;
  signed.message.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(payload.executionRequests);
  const stored = {
    slot,
    blockHash: toRootHex(signed.message.blockHash),
    parentBlockRoot: signed.message.parentBlockRoot,
    payload,
  };
  return {signed, stored};
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const item of directories.splice(0)) fs.rmSync(item, {recursive: true, force: true});
});

describe("CommitmentJournal reveal quota", () => {
  it.each(["bytes", "files"])("preserves reveal headroom after offer %s exhaustion and restart", (kind) => {
    const dir = directory();
    const journal = new CommitmentJournal(dir, identity);
    const {signed, stored} = revision(kind === "bytes" ? 27900 : 0);
    let accepted = 0;
    for (let value = 1; value <= 12; value++) {
      signed.message.value = value;
      try {
        journal.retain(signed, stored);
        accepted++;
      } catch (error) {
        expect(error).toEqual(Error("COMMITMENT_JOURNAL_CAPACITY"));
        break;
      }
    }
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(12);
    const files = fs.readdirSync(dir);
    if (kind === "files") expect(files.length).toBe(8);
    else expect(files.length).toBeLessThan(8);
    const record = {
      slot,
      blockRoot: toRootHex(Buffer.alloc(32, 3)),
      blockHash: stored.blockHash,
      envelopeRoot: toRootHex(Buffer.alloc(32, 4)),
    };
    journal.retainReveal(record);
    const restarted = new CommitmentJournal(dir, identity);
    const payloads = new PayloadStore(),
      bids = new BidStore(),
      ledger = new BidLedger();
    expect(restarted.recover(slot, payloads, bids, ledger)).toBe(accepted);
    expect(payloads.has(stored.blockHash)).toBe(true);
    expect(ledger.canReveal(record.blockRoot, record.blockHash, record.envelopeRoot)).toBe(true);
    expect(() => restarted.retain(signed, stored)).toThrow("COMMITMENT_JOURNAL_CAPACITY");
    const second = {...record, blockRoot: toRootHex(Buffer.alloc(32, 5))};
    restarted.retainReveal(second);
    const final = new CommitmentJournal(dir, identity);
    const recoveredLedger = new BidLedger();
    expect(final.recover(slot, new PayloadStore(), new BidStore(), recoveredLedger)).toBe(accepted);
    expect(recoveredLedger.canReveal(second.blockRoot, second.blockHash, second.envelopeRoot)).toBe(true);
    final.prune(slot + BID_HISTORY_SLOTS + 1);
    expect(() => final.retain(signed, stored)).not.toThrow();
  });

  it("reserves the same quota for staged hard-link offers", () => {
    const source = directory(),
      target = directory();
    const primary = new CommitmentJournal(source, identity);
    const {signed, stored} = revision();
    const reference = primary.retain(signed, stored);
    if (!reference) throw Error("Missing durable reference");
    const stage = new CommitmentJournal(target, identity, slot, source);
    for (let value = 1; value <= 6; value++) {
      signed.message.value = value;
      stage.retainReference(signed, reference);
    }
    signed.message.value++;
    expect(() => stage.retainReference(signed, reference)).toThrow("COMMITMENT_JOURNAL_CAPACITY");
    stage.retainReveal({
      slot,
      blockRoot: toRootHex(Buffer.alloc(32, 6)),
      blockHash: stored.blockHash,
      envelopeRoot: toRootHex(Buffer.alloc(32, 7)),
    });
    expect(
      new CommitmentJournal(target, identity).recover(slot, new PayloadStore(), new BidStore(), new BidLedger())
    ).toBe(6);
  });
});
