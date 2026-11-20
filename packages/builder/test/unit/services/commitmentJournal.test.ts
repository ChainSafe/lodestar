import {createHash} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {SerializedList} from "@chainsafe/ssz";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BidLedger} from "../../../src/services/bidLedger.js";
import {BidStore} from "../../../src/services/bidStore.js";
import {CommitmentJournal} from "../../../src/services/commitmentJournal.js";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {mockBuiltPayload} from "../utils/payload.js";

const directories: string[] = [];
const identity = {genesisValidatorsRoot: toRootHex(Buffer.alloc(32, 1)), pubkey: "test-builder"};
const slot = 100;

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "builder-journal-"));
  directories.push(directory);
  return {directory, journal: new CommitmentJournal(directory, identity)};
}

function revision(value: number, targetSlot = slot) {
  const blockHash = Buffer.alloc(32);
  blockHash.writeUInt32BE(targetSlot, 24);
  blockHash.writeUInt32BE(value, 28);
  const payload = mockBuiltPayload({slot: targetSlot, blockHash, valueGwei: value});
  const signed = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
  signed.message.slot = targetSlot;
  signed.message.blockHash = payload.executionPayload.blockHash;
  signed.message.parentBlockHash = payload.executionPayload.parentHash;
  signed.message.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(payload.executionRequests);
  signed.message.value = value;
  signed.signature.fill(value);
  return {
    signed,
    stored: {
      slot: targetSlot,
      parentBlockRoot: signed.message.parentBlockRoot,
      blockHash: toRootHex(signed.message.blockHash),
      payload,
    },
  };
}

function recover(directory: string, currentSlot = slot) {
  const journal = new CommitmentJournal(directory, identity);
  const payloads = new PayloadStore(),
    bids = new BidStore(),
    ledger = new BidLedger();
  const count = journal.recover(currentSlot, payloads, bids, ledger);
  return {journal, payloads, bids, ledger, count};
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) fs.rmSync(directory, {recursive: true, force: true});
});

describe("CommitmentJournal", () => {
  it.each(["requests", "parent", "payload hash", "payload slot"])(
    "rejects an unrevealable %s binding before acknowledging a commitment",
    (field) => {
      const {journal, directory} = setup();
      const original = revision(1);
      if (field === "requests") original.signed.message.executionRequestsRoot.fill(0xee);
      if (field === "parent") original.signed.message.parentBlockHash = Buffer.alloc(32, 0xee);
      if (field === "payload hash") original.stored.payload.executionPayload.blockHash = Buffer.alloc(32, 0xee);
      if (field === "payload slot") original.stored.payload.executionPayload.slotNumber++;
      expect(() => journal.retain(original.signed, original.stored)).toThrow(/COMMITMENT_/);
      expect(fs.readdirSync(directory).filter((name) => name.startsWith("bid-"))).toHaveLength(0);
    }
  );

  it("rejects a mismatched requests root during recovery of an existing checksum-valid journal", () => {
    const {journal, directory} = setup();
    const original = revision(1);
    journal.retain(original.signed, original.stored);
    const previous = fs.readdirSync(directory).find((name) => name.startsWith("bid-"));
    if (!previous) throw Error("Missing retained bid");
    original.signed.message.executionRequestsRoot.fill(0xee);
    const data = ssz.gloas.SignedExecutionPayloadBid.toJson(original.signed);
    const checksum = createHash("sha256").update(JSON.stringify(data)).digest("hex");
    const root = toRootHex(ssz.gloas.SignedExecutionPayloadBid.hashTreeRoot(original.signed));
    fs.unlinkSync(path.join(directory, previous));
    fs.writeFileSync(path.join(directory, `bid-${slot}-${root}.json`), JSON.stringify({data, checksum}));
    expect(() => recover(directory)).toThrow("COMMITMENT_EXECUTION_REQUESTS_MISMATCH");
  });

  it.each(["requests", "parent"])("rejects a mismatched %s in a staged durable reference", (field) => {
    const {journal, directory} = setup();
    const original = revision(1);
    const reference = journal.retain(original.signed, original.stored);
    if (!reference) throw Error("Missing durable reference");
    const stagedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "builder-staged-journal-"));
    directories.push(stagedDirectory);
    const staged = new CommitmentJournal(stagedDirectory, identity, slot, directory);
    if (field === "requests") original.signed.message.executionRequestsRoot.fill(0xee);
    else original.signed.message.parentBlockHash = Buffer.alloc(32, 0xee);
    expect(() => staged.retainReference(original.signed, reference)).toThrow(/COMMITMENT_/);
    expect(fs.readdirSync(stagedDirectory).filter((name) => name.startsWith("bid-"))).toHaveLength(0);
    expect(recover(directory).count).toBe(1);
  });

  it.each([false, true])("does not rebind a retained hash to new requests after restart=%s", (restart) => {
    const {journal, directory} = setup();
    const original = revision(1);
    journal.retain(original.signed, original.stored);
    const next = restart ? new CommitmentJournal(directory, identity) : journal;
    original.stored.payload.executionRequests.deposits.push(ssz.electra.DepositRequest.defaultValue());
    original.signed.message.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(
      original.stored.payload.executionRequests
    );
    original.signed.message.value++;
    expect(() => next.retain(original.signed, original.stored)).toThrow("COMMITMENT_EXECUTION_REQUESTS_MISMATCH");
    expect(recover(directory).count).toBe(1);
  });

  it.each([
    {name: "empty", offset: 0, size: 0, buffer: false, blobs: 0},
    {name: "Uint8Array subviews", offset: 7, size: 257, buffer: false, blobs: 0},
    {name: "Buffer subviews and blobs", offset: 19, size: 8192, buffer: true, blobs: 8},
  ])("preserves canonical JSON bytes and recovery for $name", ({offset, size, buffer, blobs}) => {
    const {journal, directory} = setup();
    const original = revision(1);
    const bytes = (length: number, seed = 0): Uint8Array => {
      const backing = buffer
        ? Buffer.alloc(length + offset + 11, 0xcc)
        : new Uint8Array(length + offset + 11).fill(0xcc);
      const view = backing.subarray(offset, offset + length);
      for (let i = 0; i < view.length; i++) view[i] = (i + seed) % 256;
      return view;
    };
    const payload = original.stored.payload;
    payload.sourceId = 'journal "quoted"\\path\n\u0000 \u2603 \ud800';
    payload.executionPayloadValue = 123456789012345678901234567890n;
    payload.executionPayload.transactions = SerializedList.fromArray(size ? [bytes(0), bytes(1), bytes(size)] : []);
    payload.executionPayload.blockAccessList = bytes(size * 3);
    payload.executionPayload.extraData = bytes(32);
    payload.executionPayload.baseFeePerGas = 12345678901234567890n;
    payload.blobsBundle = {
      blobs: Array.from({length: blobs}, (_, i) => bytes(131072, i)),
      commitments: Array.from({length: blobs}, (_, i) => bytes(48, i)),
      proofs: Array.from({length: blobs * 128}, (_, i) => bytes(48, i)),
    };
    original.signed.message.blobKzgCommitments = payload.blobsBundle.commitments;
    const expected = {
      slot,
      blockHash: original.stored.blockHash,
      parentBlockRoot: toRootHex(original.stored.parentBlockRoot),
      sourceId: payload.sourceId,
      value: payload.executionPayloadValue.toString(),
      payload: ssz.gloas.ExecutionPayload.toJson(payload.executionPayload),
      requests: ssz.gloas.ExecutionRequests.toJson(payload.executionRequests),
      blobRefs: payload.blobsBundle.blobs.map(
        (blob, i) =>
          `0x${createHash("sha256")
            .update(
              Buffer.concat([
                blob,
                payload.blobsBundle.commitments[i],
                ...payload.blobsBundle.proofs.slice(i * 128, (i + 1) * 128),
              ])
            )
            .digest("hex")}`
      ),
    };
    const checksum = createHash("sha256").update(JSON.stringify(expected)).digest("hex");
    if (size === 0) {
      // Recorded with the previous writer, including escaped metadata and bigint fields.
      expect(checksum).toBe("79cefb636294c9790c8d5af85f003d7d935eea866bdf18012493ba85c1553daf");
    }
    const canonical = JSON.stringify({data: expected, checksum});
    journal.retain(original.signed, original.stored);
    expect(fs.readdirSync(directory).filter((name) => name.startsWith("blob-"))).toHaveLength(blobs);
    expect(fs.readFileSync(path.join(directory, `payload-${slot}-${original.stored.blockHash}.json`), "utf8")).toBe(
      canonical
    );
    expect(ssz.gloas.ExecutionPayload.toJson(payload.executionPayload)).toEqual(expected.payload);
    const recovered = recover(directory);
    expect(recovered.count).toBe(1);
    const restored = recovered.payloads.get(original.stored.blockHash)?.payload;
    if (!restored) throw Error("Missing recovered payload");
    expect(ssz.gloas.ExecutionPayload.equals(restored.executionPayload, payload.executionPayload)).toBe(true);
    expect(ssz.gloas.BlobsBundle.equals(restored.blobsBundle, payload.blobsBundle)).toBe(true);
    expect(restored.sourceId).toBe(payload.sourceId);
    expect(restored.executionPayloadValue).toBe(payload.executionPayloadValue);
  });

  it("does not acknowledge a sparse transaction list that cannot be recovered", () => {
    const {journal, directory} = setup();
    const original = revision(1);
    // @ts-expect-error A malformed, sparse list must never be acknowledged.
    original.stored.payload.executionPayload.transactions = new Array<Uint8Array>(1);
    expect(() => journal.retain(original.signed, original.stored)).toThrow();
    expect(recover(directory).count).toBe(0);
  });

  it("acknowledges durable retention when optional reference metadata cannot be read", () => {
    const {journal, directory} = setup();
    const original = revision(1);
    const stat = vi.spyOn(fs, "lstatSync").mockImplementation(() => {
      throw Error("injected metadata failure");
    });
    expect(journal.retain(original.signed, original.stored)).toBeUndefined();
    stat.mockRestore();
    expect(journal.retain(original.signed, original.stored)).toBeUndefined();
    expect(recover(directory).count).toBe(1);
  });

  it.each(["EXDEV", "ENOENT", "EPERM", "EMLINK"])(
    "keeps ordinary retention available after reference link error %s",
    (code) => {
      const primary = setup();
      const secondary = setup();
      const original = revision(1);
      const reference = primary.journal.retain(original.signed, original.stored);
      if (!reference) throw Error("Missing reference");
      const journal = new CommitmentJournal(secondary.directory, identity, undefined, primary.directory);
      const link = vi.spyOn(fs, "linkSync").mockImplementation(() => {
        throw Object.assign(Error(code), {code});
      });
      expect(() => journal.retainReference(original.signed, reference)).toThrow("COMMITMENT_REFERENCE_UNAVAILABLE");
      journal.retain(original.signed, original.stored);
      link.mockRestore();
      expect(recover(secondary.directory).count).toBe(1);
    }
  );

  it.each(["renameSync", "fsyncSync"] as const)(
    "poisons reference retention after an uncertain %s failure without recovering an offer",
    (operation) => {
      const primary = setup();
      const secondary = setup();
      const original = revision(1);
      const reference = primary.journal.retain(original.signed, original.stored);
      if (!reference) throw Error("Missing durable reference");
      const journal = new CommitmentJournal(secondary.directory, identity, undefined, primary.directory);
      const cause = Object.assign(Error(`injected ${operation} failure`), {code: "EIO"});
      const failure = vi.spyOn(fs, operation).mockImplementation(() => {
        throw cause;
      });
      let thrown: unknown;
      try {
        journal.retainReference(original.signed, reference);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(cause);
      expect(failure).toHaveBeenCalledOnce();
      failure.mockRestore();
      expect(() => journal.retainReference(original.signed, reference)).toThrow("COMMITMENT_JOURNAL_FAILED");
      expect(() => journal.retain(original.signed, original.stored)).toThrow("COMMITMENT_JOURNAL_FAILED");
      expect(fs.readdirSync(secondary.directory).some((name) => name.startsWith("bid-"))).toBe(false);
      const recovered = recover(secondary.directory);
      expect(recovered.count).toBe(0);
      expect(recovered.bids.has(original.signed)).toBe(false);
      expect(recover(primary.directory).bids.has(original.signed)).toBe(true);
    }
  );

  it("retains an acknowledged payload by reference without reading or serializing its bytes", () => {
    const primary = setup();
    const secondary = setup();
    const original = revision(1);
    original.stored.payload.blobsBundle = {
      blobs: [new Uint8Array(131072).fill(1)],
      commitments: [new Uint8Array(48).fill(2)],
      proofs: Array.from({length: 128}, (_, i) => new Uint8Array(48).fill(i)),
    };
    original.signed.message.blobKzgCommitments = original.stored.payload.blobsBundle.commitments;
    const reference = primary.journal.retain(original.signed, original.stored);
    if (!reference) throw Error("Missing durable reference");
    const journal = new CommitmentJournal(secondary.directory, identity, undefined, primary.directory);
    const signed = structuredClone(original.signed);
    signed.message.builderIndex = 2;
    const read = vi.spyOn(fs, "readFileSync");
    const serialize = vi.spyOn(ssz.gloas.ExecutionPayload, "toJson");
    journal.retainReference(signed, structuredClone(reference));
    expect(read).not.toHaveBeenCalled();
    expect(serialize).not.toHaveBeenCalled();
    read.mockRestore();
    serialize.mockRestore();
    for (const file of reference.files) {
      expect(fs.statSync(path.join(secondary.directory, file.name)).ino).toBe(Number(file.ino));
    }
    primary.journal.prune(slot + 3);
    const recovered = recover(secondary.directory);
    expect(recovered.count).toBe(1);
    const payload = recovered.payloads.get(original.stored.blockHash)?.payload;
    if (!payload) throw Error("Missing recovered payload");
    expect(ssz.gloas.ExecutionPayload.equals(payload.executionPayload, original.stored.payload.executionPayload)).toBe(
      true
    );
    expect(
      ssz.gloas.ExecutionRequests.equals(payload.executionRequests, original.stored.payload.executionRequests)
    ).toBe(true);
    expect(ssz.gloas.BlobsBundle.equals(payload.blobsBundle, original.stored.payload.blobsBundle)).toBe(true);
    expect(payload.executionPayloadValue).toBe(original.stored.payload.executionPayloadValue);
  });

  it.each(["replaced", "modified", "symlink", "pruned"])("refuses a %s source without publishing a bid", (kind) => {
    const primary = setup();
    const secondary = setup();
    const original = revision(1);
    const reference = primary.journal.retain(original.signed, original.stored);
    if (!reference) throw Error("Missing durable reference");
    const file = path.join(primary.directory, reference.files[0].name);
    if (kind === "pruned") primary.journal.prune(slot + 3);
    else if (kind === "modified") fs.appendFileSync(file, " ");
    else {
      fs.renameSync(file, `${file}.old`);
      if (kind === "symlink") fs.symlinkSync(`${file}.old`, file);
      else fs.copyFileSync(`${file}.old`, file);
    }
    const journal = new CommitmentJournal(secondary.directory, identity, undefined, primary.directory);
    expect(() => journal.retainReference(original.signed, reference)).toThrow();
    expect(fs.readdirSync(secondary.directory)).toEqual(["identity.json"]);
    expect(recover(secondary.directory).count).toBe(0);
  });

  it("does not leave a payload referencing missing sidecars after a failed reference import", () => {
    const primary = setup();
    const secondary = setup();
    const original = revision(1);
    original.stored.payload.blobsBundle = {
      blobs: [new Uint8Array(131072).fill(1), new Uint8Array(131072).fill(2)],
      commitments: [new Uint8Array(48).fill(2), new Uint8Array(48).fill(3)],
      proofs: Array.from({length: 256}, (_, i) => new Uint8Array(48).fill(i)),
    };
    original.signed.message.blobKzgCommitments = original.stored.payload.blobsBundle.commitments;
    const reference = primary.journal.retain(original.signed, original.stored);
    if (!reference) throw Error("Missing durable reference");
    fs.unlinkSync(path.join(primary.directory, reference.files[2].name));
    const journal = new CommitmentJournal(secondary.directory, identity, undefined, primary.directory);
    expect(() => journal.retainReference(original.signed, reference)).toThrow();
    expect(
      fs.readdirSync(secondary.directory).filter((name) => name.startsWith("payload-") || name.startsWith("bid-"))
    ).toEqual([]);
    expect(recover(secondary.directory).count).toBe(0);
  });

  it("shares immutable payload files across identities and retains them after source pruning", () => {
    const primary = setup();
    const secondary = setup();
    const original = revision(1);
    original.stored.payload.blobsBundle = {
      blobs: [new Uint8Array(131072).fill(1)],
      commitments: [new Uint8Array(48).fill(2)],
      proofs: Array.from({length: 128}, (_, i) => new Uint8Array(48).fill(i)),
    };
    original.signed.message.blobKzgCommitments = original.stored.payload.blobsBundle.commitments;
    primary.journal.retain(original.signed, original.stored);
    const signed = structuredClone(original.signed);
    signed.message.builderIndex = 2;
    const journal = new CommitmentJournal(secondary.directory, identity, undefined, primary.directory);
    journal.retain(signed, original.stored);
    const files = fs.readdirSync(secondary.directory).filter((name) => /^(blob|payload)-/.test(name));
    expect(files).toHaveLength(2);
    for (const name of files) {
      const source = fs.statSync(path.join(primary.directory, name));
      const dest = fs.statSync(path.join(secondary.directory, name));
      expect(dest.ino, name).toBe(source.ino);
      expect(dest.nlink, name).toBe(2);
    }
    primary.journal.prune(slot + 3);
    const restored = recover(secondary.directory);
    expect(restored.count).toBe(1);
    expect(restored.bids.has(signed)).toBe(true);
    expect(restored.bids.has(original.signed)).toBe(false);
    const payload = restored.payloads.get(original.stored.blockHash)?.payload;
    if (!payload) throw Error("Missing shared payload after source pruning");
    expect(ssz.gloas.ExecutionPayload.equals(payload.executionPayload, original.stored.payload.executionPayload)).toBe(
      true
    );
    expect(payload.blobsBundle).toEqual(original.stored.payload.blobsBundle);
    expect(payload.executionPayloadValue).toBe(original.stored.payload.executionPayloadValue);
    journal.prune(slot + 3);
    expect(fs.readdirSync(secondary.directory).filter((name) => /^(blob|payload)-/.test(name))).toEqual([]);
  });

  it.each(["ENOENT", "EXDEV", "EPERM", "EACCES", "EMLINK", "EIO"])(
    "writes its own durable copy when sharing is unavailable: %s",
    (code) => {
      const primary = setup();
      const secondary = setup();
      const original = revision(1);
      primary.journal.retain(original.signed, original.stored);
      vi.spyOn(fs, "linkSync").mockImplementation(() => {
        throw Object.assign(Error(code), {code});
      });
      new CommitmentJournal(secondary.directory, identity, undefined, primary.directory).retain(
        original.signed,
        original.stored
      );
      expect(fs.linkSync).toHaveBeenCalled();
      expect(recover(secondary.directory).bids.has(original.signed)).toBe(true);
    }
  );

  it.each(["different bytes", "symlink"])("replaces a shared payload with %s with a recoverable copy", (kind) => {
    const primary = setup();
    const secondary = setup();
    const original = revision(1);
    primary.journal.retain(original.signed, original.stored);
    const name = `payload-${slot}-${original.stored.blockHash}.json`;
    const file = path.join(primary.directory, name);
    if (kind === "different bytes") {
      const bytes = fs.readFileSync(file);
      bytes[bytes.length - 1] ^= 1;
      fs.writeFileSync(file, bytes);
    } else {
      fs.renameSync(file, `${file}.original`);
      fs.symlinkSync(`${file}.original`, file);
    }
    const journal = new CommitmentJournal(secondary.directory, identity, undefined, primary.directory);
    journal.retain(original.signed, original.stored);
    expect(recover(secondary.directory).bids.has(original.signed)).toBe(true);
    expect(fs.lstatSync(path.join(secondary.directory, name)).isFile()).toBe(true);
    const later = revision(2);
    journal.retain(later.signed, later.stored);
    expect(recover(secondary.directory).count).toBe(2);
  });

  it("never writes through an unverified temporary link left by a crash", () => {
    const primary = setup();
    const secondary = setup();
    const original = revision(1);
    primary.journal.retain(original.signed, original.stored);
    const source = path.join(primary.directory, `payload-${slot}-${original.stored.blockHash}.json`);
    const before = fs.readFileSync(source);
    const later = revision(2);
    const target = path.join(secondary.directory, `payload-${slot}-${later.stored.blockHash}.json`);
    fs.symlinkSync(source, `${target}.tmp`);
    new CommitmentJournal(secondary.directory, identity, undefined, primary.directory).retain(
      later.signed,
      later.stored
    );
    expect(fs.readFileSync(source)).toEqual(before);
    expect(recover(secondary.directory).bids.has(later.signed)).toBe(true);
  });

  it("cleans abandoned temporary links after verifying the journal identity", () => {
    const primary = setup();
    const secondary = setup();
    const original = revision(1);
    primary.journal.retain(original.signed, original.stored);
    const name = `payload-${slot}-${original.stored.blockHash}.json`;
    const source = path.join(primary.directory, name);
    const temporary = path.join(secondary.directory, `${name}.tmp`);
    fs.linkSync(source, temporary);
    expect(fs.statSync(source).nlink).toBe(2);
    expect(() => new CommitmentJournal(secondary.directory, {...identity, pubkey: "other"})).toThrow(
      "COMMITMENT_JOURNAL_IDENTITY_MISMATCH"
    );
    expect(fs.existsSync(temporary)).toBe(true);
    expect(recover(secondary.directory).count).toBe(0);
    expect(fs.existsSync(temporary)).toBe(false);
    expect(fs.statSync(source).nlink).toBe(1);
    expect(recover(primary.directory).bids.has(original.signed)).toBe(true);
  });

  it("rejects sharing from the same directory", () => {
    const {directory} = setup();
    expect(() => new CommitmentJournal(directory, identity, undefined, path.join(directory, "."))).toThrow(
      "COMMITMENT_SHARED_DIRECTORY"
    );
  });

  it("recovers a crash during the first identity write", () => {
    const {directory} = setup();
    fs.renameSync(path.join(directory, "identity.json"), path.join(directory, "identity.json.tmp"));
    expect(recover(directory).count).toBe(0);
    expect(fs.readdirSync(directory)).toEqual(["identity.json"]);
  });

  it("does not publish a bid when syncing the shared directory entry fails", () => {
    const primary = setup();
    const secondary = setup();
    const original = revision(1);
    primary.journal.retain(original.signed, original.stored);
    const journal = new CommitmentJournal(secondary.directory, identity, undefined, primary.directory);
    vi.spyOn(fs, "fsyncSync").mockImplementation(() => {
      throw Error("sync failed");
    });
    expect(() => journal.retain(original.signed, original.stored)).toThrow("sync failed");
    expect(fs.readdirSync(secondary.directory).some((n) => n.startsWith("bid-"))).toBe(false);
    vi.restoreAllMocks();
    expect(recover(secondary.directory).count).toBe(0);
  });

  it("deduplicates sidecars across revisions, preserves repeated order and prunes by slot", () => {
    const {directory, journal} = setup();
    const first = revision(1);
    const bundle = {
      blobs: [new Uint8Array(131072).fill(1), new Uint8Array(131072).fill(1)],
      commitments: [new Uint8Array(48).fill(2), new Uint8Array(48).fill(2)],
      proofs: Array.from({length: 256}, (_, i) => new Uint8Array(48).fill(i % 128)),
    };
    first.stored.payload.blobsBundle = bundle;
    first.signed.message.blobKzgCommitments = bundle.commitments;
    journal.retain(first.signed, first.stored);
    const second = revision(2);
    second.stored.payload.blobsBundle = bundle;
    second.signed.message.blobKzgCommitments = bundle.commitments;
    journal.retain(second.signed, second.stored);
    expect(fs.readdirSync(directory).filter((name) => name.startsWith("blob-"))).toHaveLength(1);
    const restored = recover(directory);
    for (const original of [first, second]) {
      expect(restored.payloads.get(original.stored.blockHash)?.payload.blobsBundle, original.stored.blockHash).toEqual(
        bundle
      );
    }
    const later = revision(3, slot + 1);
    later.stored.payload.blobsBundle = bundle;
    later.signed.message.blobKzgCommitments = bundle.commitments;
    journal.retain(later.signed, later.stored);
    journal.prune(slot + 3);
    expect(fs.readdirSync(directory).filter((name) => name.startsWith("blob-"))).toHaveLength(1);
    expect(recover(directory, slot + 3).payloads.get(later.stored.blockHash)?.payload.blobsBundle).toEqual(bundle);
  });

  it.each(["missing", "corrupt"])("rejects a %s sidecar during recovery", (kind) => {
    const {directory, journal} = setup();
    const original = revision(1);
    original.stored.payload.blobsBundle = {
      blobs: [new Uint8Array(131072)],
      commitments: [new Uint8Array(48)],
      proofs: Array.from({length: 128}, () => new Uint8Array(48)),
    };
    original.signed.message.blobKzgCommitments = original.stored.payload.blobsBundle.commitments;
    journal.retain(original.signed, original.stored);
    const name = fs.readdirSync(directory).find((name) => name.startsWith("blob-"));
    if (!name) throw Error("Missing sidecar fixture");
    const filename = path.join(directory, name);
    if (kind === "missing") fs.unlinkSync(filename);
    else {
      const bytes = fs.readFileSync(filename);
      bytes[0] ^= 1;
      fs.writeFileSync(filename, bytes);
    }
    expect(() => recover(directory)).toThrow(
      kind === "missing" ? "COMMITMENT_BLOB_MISSING" : "COMMITMENT_BLOB_CHECKSUM"
    );
  });

  it("recovers legacy payload records containing embedded blob data", () => {
    const {directory, journal} = setup();
    const original = revision(1);
    original.signed.message.blobKzgCommitments = original.stored.payload.blobsBundle.commitments;
    journal.retain(original.signed, original.stored);
    const name = fs.readdirSync(directory).find((name) => name.startsWith("payload-"));
    if (!name) throw Error("Missing payload fixture");
    const filename = path.join(directory, name);
    const {data} = JSON.parse(fs.readFileSync(filename, "utf8"));
    delete data.blobRefs;
    data.blobs = ssz.gloas.BlobsBundle.toJson(original.stored.payload.blobsBundle);
    fs.writeFileSync(
      filename,
      JSON.stringify({data, checksum: createHash("sha256").update(JSON.stringify(data)).digest("hex")})
    );
    expect(recover(directory).payloads.get(original.stored.blockHash)?.payload.blobsBundle).toEqual(
      original.stored.payload.blobsBundle
    );
  });

  it("prunes corrupt expired sidecars before startup validation", () => {
    const {directory} = setup();
    fs.writeFileSync(path.join(directory, `blob-${slot - 3}-${toRootHex(Buffer.alloc(32))}.bin`), Buffer.alloc(1));
    expect(() => new CommitmentJournal(directory, {...identity, pubkey: "other-builder"}, slot)).toThrow(
      "COMMITMENT_JOURNAL_IDENTITY_MISMATCH"
    );
    expect(fs.readdirSync(directory)).toHaveLength(2);
    const journal = new CommitmentJournal(directory, identity, slot);
    expect(journal.recover(slot, new PayloadStore(), new BidStore(), new BidLedger())).toBe(0);
    expect(fs.readdirSync(directory)).toEqual(["identity.json"]);
  });

  it.each(["blob-", "payload-"])("does not recover an offer if its %s write failed", (prefix) => {
    const {directory, journal} = setup();
    const original = revision(1);
    original.stored.payload.blobsBundle = {
      blobs: [new Uint8Array(131072)],
      commitments: [new Uint8Array(48)],
      proofs: Array.from({length: 128}, () => new Uint8Array(48)),
    };
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (path.basename(String(to)).startsWith(prefix)) throw Error("disk failed");
      rename(from, to);
    });
    original.signed.message.blobKzgCommitments = original.stored.payload.blobsBundle.commitments;
    expect(() => journal.retain(original.signed, original.stored)).toThrow("disk failed");
    vi.restoreAllMocks();
    expect(recover(directory).count).toBe(0);
  });
  it("recovers every blob and cell proof for an older selected revision", () => {
    const {directory, journal} = setup();
    const original = revision(1);
    original.stored.payload.executionPayload.blobGasUsed = 131072n;
    original.stored.payload.blobsBundle = {
      blobs: [new Uint8Array(131072).fill(1)],
      commitments: [new Uint8Array(48).fill(2)],
      proofs: Array.from({length: 128}, (_, i) => new Uint8Array(48).fill(i)),
    };
    original.signed.message.blobKzgCommitments = original.stored.payload.blobsBundle.commitments;
    original.signed.message.blobKzgCommitments = original.stored.payload.blobsBundle.commitments;
    journal.retain(original.signed, original.stored);
    journal.retain(revision(2).signed, revision(2).stored);
    const {payloads, bids, count} = recover(directory);
    expect(count).toBe(2);
    expect(bids.has(original.signed)).toBe(true);
    const restored = payloads.get(original.stored.blockHash);
    expect(restored?.payload.blobsBundle).toEqual(original.stored.payload.blobsBundle);
    original.stored.payload.blobsBundle.blobs[0].fill(3);
    expect(restored?.payload.blobsBundle.blobs[0][0]).toBe(1);
    expect(restored?.payload.blobsBundle.proofs[127][0]).toBe(127);
  });

  it("recovers full overlapping slots and keeps old revisions selectable above a lower admission limit", () => {
    const {directory, journal} = setup();
    const originals = Array.from({length: 1024}, (_, i) => {
      const original = revision((i % 256) + 1, slot - 2 + Math.floor(i / 256));
      original.signed.message.parentBlockRoot.fill(i % 2);
      original.signed.message.blobKzgCommitments = original.stored.payload.blobsBundle.commitments;
      journal.retain(original.signed, original.stored);
      return original;
    });
    const {payloads, bids, ledger, count} = recover(directory);
    expect(count).toBe(1024);
    expect(payloads.size).toBe(1024);
    expect(ledger.getUnsettledValueGwei(4)).toBe(4 * 256);
    for (const original of originals) {
      const label = `slot ${original.stored.slot} value ${original.signed.message.value}`;
      expect(bids.has(original.signed), label).toBe(true);
      const restored = payloads.get(original.stored.blockHash);
      if (!restored) throw Error(`Missing payload for ${label}`);
      expect(ssz.gloas.ExecutionPayload.serialize(restored.payload.executionPayload), label).toEqual(
        ssz.gloas.ExecutionPayload.serialize(original.stored.payload.executionPayload)
      );
      expect(restored.payload.executionPayloadValue, label).toBe(original.stored.payload.executionPayloadValue);
    }
    expect(() => ledger.assertCanRecordRevision(ledger.getBidsForSlot(slot)[0], 64)).toThrow();
    const old = ledger.getBidsForSlot(slot - 2).find((record) => record.blockHash === originals[0].stored.blockHash);
    if (!old) throw Error("Missing oldest selectable revision");
    const blockRoot = toRootHex(Buffer.alloc(32, 7));
    const envelopeRoot = toRootHex(Buffer.alloc(32, 8));
    expect(ledger.recordWin(old, blockRoot)).not.toBeNull();
    journal.retainReveal({slot: old.slot, blockRoot, blockHash: old.blockHash, envelopeRoot});
    ledger.recordReveal(old.slot, blockRoot, old.blockHash, envelopeRoot);
    const restarted = recover(directory);
    expect(restarted.ledger.canReveal(blockRoot, old.blockHash, envelopeRoot)).toBe(true);
    expect(restarted.ledger.canReveal(blockRoot, old.blockHash, toRootHex(Buffer.alloc(32, 9)))).toBe(false);
    const later = recover(directory, slot + 1);
    expect(later.payloads.size).toBe(768);
    expect(later.count).toBe(1024);
    expect(later.bids.has(originals[0].signed)).toBe(false);
    expect(later.bids.has(originals[256].signed)).toBe(true);
    const next = revision(1, slot + 2);
    later.payloads.add(next.stored);
    later.journal.retain(next.signed, next.stored);
    expect(recover(directory, slot + 1).payloads.size).toBe(769);
  }, 60_000);

  it("fits a full bid history at the revision limit and recovers it after restart", () => {
    const {directory, journal} = setup();
    const currentSlot = slot + 3 * SLOTS_PER_EPOCH;
    for (let targetSlot = slot; targetSlot <= currentSlot + 1; targetSlot++) {
      journal.prune(targetSlot - 1);
      const original = revision(256, targetSlot);
      for (let value = 1; value <= 256; value++) {
        const signed = {...original.signed, message: {...original.signed.message, value}};
        journal.retain(signed, original.stored);
      }
    }
    const {count, payloads, ledger, bids} = recover(directory, currentSlot);
    expect(count).toBe(256 * (3 * SLOTS_PER_EPOCH + 2));
    expect(payloads.size).toBe(4);
    expect(ledger.getBidsForSlot(slot)).toHaveLength(256);
    const oldest = revision(256, currentSlot - 2);
    expect(bids.has(oldest.signed)).toBe(true);
    const record = {
      slot: currentSlot - 2,
      blockRoot: toRootHex(Buffer.alloc(32, 7)),
      blockHash: oldest.stored.blockHash,
      envelopeRoot: toRootHex(Buffer.alloc(32, 8)),
    };
    journal.retainReveal(record);
    expect(recover(directory, currentSlot).ledger.hasRevealed(record.blockRoot)).toBe(true);
  }, 600_000);

  it("recovers every selectable revision and payload, reserves one liability per slot, and consumes gossip allowance", () => {
    const {directory, journal} = setup();
    const first = revision(1),
      second = revision(2);
    journal.retain(first.signed, first.stored);
    journal.retain(second.signed, second.stored);
    const {bids, payloads, ledger, count} = recover(directory);
    expect(count).toBe(2);
    expect(bids.has(first.signed)).toBe(true);
    expect(bids.has(second.signed)).toBe(true);
    for (const original of [first, second]) {
      const restored = payloads.get(original.stored.blockHash);
      if (!restored) throw Error("Missing recovered payload");
      expect(ssz.gloas.ExecutionPayload.serialize(restored.payload.executionPayload)).toEqual(
        ssz.gloas.ExecutionPayload.serialize(original.stored.payload.executionPayload)
      );
      expect(restored.payload.executionPayloadValue).toBe(original.stored.payload.executionPayloadValue);
    }
    expect(ledger.getUnsettledValueGwei(4)).toBe(2);
    const bid = first.signed.message;
    expect(ledger.hasSubmitted(slot, toRootHex(bid.parentBlockHash), toRootHex(bid.parentBlockRoot))).toBe(true);
    const old = ledger.getBidsForSlot(slot).find((record) => record.blockHash === first.stored.blockHash);
    expect(old).toBeDefined();
    if (!old) throw Error("Missing recovered revision");
    const blockRoot = toRootHex(Buffer.alloc(32, 7));
    expect(ledger.recordWin(old, blockRoot)?.blockHash).toBe(first.stored.blockHash);
    expect(ledger.hasWon(old, blockRoot)).toBe(true);
    ledger.settlePaymentsBefore(slot + 1);
    expect(ledger.getUnsettledValueGwei(4)).toBe(0);
  });

  it("retains reveal conflicts across restart while permitting an identical retry", () => {
    const {directory, journal} = setup();
    const record = {
      slot,
      blockRoot: toRootHex(Buffer.alloc(32, 3)),
      blockHash: toRootHex(Buffer.alloc(32, 4)),
      envelopeRoot: toRootHex(Buffer.alloc(32, 5)),
    };
    journal.retainReveal(record);
    journal.retainReveal(record);
    const {ledger} = recover(directory);
    expect(ledger.canReveal(record.blockRoot, record.blockHash, record.envelopeRoot)).toBe(true);
    expect(ledger.canReveal(record.blockRoot, record.blockHash, toRootHex(Buffer.alloc(32, 6)))).toBe(false);
    expect(() => journal.retainReveal({...record, blockHash: toRootHex(Buffer.alloc(32, 9))})).toThrow(
      "COMMITMENT_REVEAL_CONFLICT"
    );
  });

  it("fails closed on disk errors, ignores an incomplete temporary write, and never recovers a partial offer", () => {
    const {directory, journal} = setup();
    const first = revision(1);
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to).includes("bid-")) throw Error("disk failed");
      rename(from, to);
    });
    expect(() => journal.retain(first.signed, first.stored)).toThrow("disk failed");
    expect(() => journal.retain(first.signed, first.stored)).toThrow("COMMITMENT_JOURNAL_FAILED");
    vi.restoreAllMocks();
    const recovered = recover(directory);
    expect(recovered.count).toBe(0);
    expect(recovered.bids.has(first.signed)).toBe(false);
  });

  it("rejects a missing committed payload, disk corruption, and another network or identity", () => {
    const {directory, journal} = setup();
    const first = revision(1);
    journal.retain(first.signed, first.stored);
    expect(() => new CommitmentJournal(directory, {...identity, pubkey: "another"})).toThrow(
      "COMMITMENT_JOURNAL_IDENTITY_MISMATCH"
    );
    const payloadName = fs.readdirSync(directory).find((name) => name.startsWith("payload-"));
    if (!payloadName) throw Error("Missing fixture payload");
    fs.unlinkSync(path.join(directory, payloadName));
    expect(() => recover(directory)).toThrow("COMMITMENT_PAYLOAD_MISSING");
    const bidName = fs.readdirSync(directory).find((name) => name.startsWith("bid-"));
    if (!bidName) throw Error("Missing fixture bid");
    const filename = path.join(directory, bidName);
    const record = JSON.parse(fs.readFileSync(filename, "utf8"));
    record.data.signedBid.message.value = "999";
    fs.writeFileSync(filename, JSON.stringify(record));
    expect(() => recover(directory)).toThrow("COMMITMENT_JOURNAL_CHECKSUM");
  });

  it("prunes payloads after the reveal window but keeps conservative liabilities until payment settlement", () => {
    const {directory, journal} = setup();
    const first = revision(1);
    journal.retain(first.signed, first.stored);
    const recovered = recover(directory, slot + 3);
    expect(recovered.payloads.size).toBe(0);
    expect(recovered.bids.has(first.signed)).toBe(false);
    expect(recovered.ledger.getUnsettledValueGwei(4)).toBe(1);
    const expired = recover(directory, slot + 3 * SLOTS_PER_EPOCH + 1);
    expect(expired.count).toBe(0);
    expect(fs.readdirSync(directory)).toEqual(["identity.json"]);
  });
});
