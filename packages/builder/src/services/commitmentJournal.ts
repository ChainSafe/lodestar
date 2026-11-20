import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {Type} from "@chainsafe/ssz";
import {CELLS_PER_EXT_BLOB, FIELD_ELEMENTS_PER_BLOB} from "@lodestar/params";
import {RootHex, gloas, ssz} from "@lodestar/types";
import {fromHex, toHex, toRootHex} from "@lodestar/utils";
import {BidLedger} from "./bidLedger.js";
import {BidStore} from "./bidStore.js";
import {CommitmentJournalError} from "./commitmentJournalError.js";
import {
  BID_HISTORY_SLOTS,
  MAX_BID_REVISIONS_PER_SLOT,
  MAX_COMMITMENT_JOURNAL_BYTES,
  MAX_COMMITMENT_JOURNAL_FILES,
  MAX_REVEAL_RECORD_BYTES,
  PAYLOAD_RETENTION_SLOTS,
  RESERVED_REVEAL_BYTES,
  RESERVED_REVEAL_FILES,
} from "./commitmentLimits.js";
import {
  EXPOSURE_CLOCK_TOLERANCE_MS,
  type JournalExposure,
  MAX_EXPOSURE_COMMITMENTS,
  type OrderCommitment,
} from "./orderExposure.js";
import {type OrderMetadata, isOrderOfferAllowed, parseOrderMetadata, sameOrderMetadata} from "./orderMetadata.js";
import {PayloadStore, StoredPayload} from "./payloadStore.js";

const KEEP_SLOTS = BID_HISTORY_SLOTS;
const MAX_BYTES = MAX_COMMITMENT_JOURNAL_BYTES;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_FILES = MAX_COMMITMENT_JOURNAL_FILES;
// Index the retained bid history within the journal's file quota. The byte budget
// charges encoded records, not heap usage, and remains independently fail-closed.
const MAX_EXPOSURE_BYTES = 64 * 1024 * 1024;
const MAX_EXPOSURE_FILE_BYTES = 32 * 1024;
const MAX_FORGOTTEN_ORDER_IDS = 8192;
const recordName = /^(payload|bid|reveal|blob)-(\d+)-(0x[0-9a-f]{64})\.(json|bin)$/;
const BLOB_BYTES = FIELD_ELEMENTS_PER_BLOB * 32;
const COMMITMENT_BYTES = 48;
const SIDECAR_BYTES = BLOB_BYTES + COMMITMENT_BYTES * (1 + CELLS_PER_EXT_BLOB);

type PayloadRecord = {
  orderMetadata?: OrderMetadata;
  slot: number;
  parentBlockRoot: RootHex;
  blockHash: RootHex;
  sourceId: string;
  value: string;
  payload: unknown;
  requests: unknown;
  blobs?: unknown;
  blobRefs?: RootHex[];
};

export type RevealRecord = {slot: number; blockRoot: RootHex; blockHash: RootHex; envelopeRoot: RootHex};
export type JournalIdentity = {genesisValidatorsRoot: RootHex; pubkey: string};
type DurableFile = {name: string; bytes: number; dev: bigint; ino: bigint; mtimeNs: bigint};
/** Issued only after durable retention. Files are immutable; recipients hard-link
 * them into their own journal before publishing, independently of source pruning. */
export type DurablePayload = {
  orderMetadata?: OrderMetadata;
  slot: number;
  blockHash: RootHex;
  parentBlockHash: RootHex;
  parentBlockRoot: RootHex;
  executionRequestsRoot: RootHex;
  commitments: Uint8Array[];
  files: DurableFile[];
};

/** Single-process Gloas journal. Commit files and their directory are synced
 * before an offer becomes externally visible. An uncertain write poisons new
 * journal operations; restarting reconciles complete records. Not a key store.
 * Disk recovery conservatively reserves all recent offers as possible wins and
 * consumes their gossip allowance. This covers selection events missed offline. */
export class CommitmentJournal {
  private readonly sizes = new Map<string, number>();
  private readonly admissionsBySlot = new Map<number, number>();
  private bytes = 0;
  private revealBytes = 0;
  private revealFiles = 0;
  private failed = false;
  private readonly references = new Map<string, DurablePayload | undefined>();
  private readonly exposure = new Map<
    string,
    {metadata?: OrderMetadata; commitment: OrderCommitment | null; bytes: number}
  >();
  private exposureBytes = 0;
  private exposureIncomplete = false;
  private prunedThroughUnixMs = 0;
  private readonly forgottenOrderIds = new Set<string>();
  private readonly exposureClock = {unix: Date.now(), monotonic: performance.now()};
  private lastExposureUnixMs = this.exposureClock.unix;

  constructor(
    private readonly directory: string,
    private readonly identity: JournalIdentity,
    currentSlot?: number,
    private readonly sharedPayloadDirectory?: string
  ) {
    if (sharedPayloadDirectory !== undefined && path.resolve(sharedPayloadDirectory) === path.resolve(directory))
      throw Error("COMMITMENT_SHARED_DIRECTORY");
    ensureCommitmentDirectory(directory);
    const names = fs.readdirSync(directory);
    const incomplete = names.filter(
      (name) => name.endsWith(".tmp") && (name === "identity.json.tmp" || recordName.test(name.slice(0, -4)))
    );
    if (names.length - incomplete.length > MAX_FILES * 2) throw Error("COMMITMENT_JOURNAL_FILE_LIMIT");
    for (const name of names) {
      if (!recordName.test(name) && name !== "identity.json") continue;
      const info = fs.lstatSync(path.join(directory, name));
      const match = recordName.exec(name);
      if (!info.isFile() || info.size > MAX_FILE_BYTES || (match && (match[1] === "blob") !== (match[4] === "bin")))
        throw Error("COMMITMENT_JOURNAL_INVALID_FILE");
      this.sizes.set(name, info.size);
      this.bytes += info.size;
      if (match?.[1] === "bid") {
        const slot = Number(match[2]);
        this.admissionsBySlot.set(slot, (this.admissionsBySlot.get(slot) ?? 0) + 1);
      }
      if (match?.[1] === "reveal") {
        this.revealBytes += info.size;
        this.revealFiles++;
      }
    }
    const expected = {version: 1, ...identity};
    if (this.sizes.has("identity.json")) {
      if (JSON.stringify(this.read("identity.json")) !== JSON.stringify(expected))
        throw Error("COMMITMENT_JOURNAL_IDENTITY_MISMATCH");
    } else {
      if (this.sizes.size) throw Error("COMMITMENT_JOURNAL_IDENTITY_MISSING");
      this.write("identity.json", expected);
    }
    // Only after identity validation: abandoned temporary links have no reveal obligation, but would
    // otherwise pin unaccounted source data after pruning. Never follow them or remove unknown files.
    for (const name of incomplete) {
      try {
        fs.unlinkSync(path.join(directory, name));
      } catch (error) {
        // Creating a missing identity may already have consumed identity.json.tmp.
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
    if (incomplete.length) syncDirectory(directory);
    // Expired records carry no reveal obligation. Remove them before checking
    // sidecar contents, just as recovery does for legacy payload records.
    if (currentSlot !== undefined) this.prune(currentSlot);
    if (this.bytes > MAX_BYTES || this.sizes.size > MAX_FILES) throw Error("COMMITMENT_JOURNAL_CAPACITY");
    for (const [name, size] of this.sizes) {
      if (name.startsWith("bid-")) {
        if (
          size > MAX_EXPOSURE_FILE_BYTES ||
          this.exposure.size >= MAX_FILES ||
          this.exposureBytes + size > MAX_EXPOSURE_BYTES
        ) {
          this.exposureIncomplete = true;
        } else {
          this.indexExposure(name, this.read(name), size);
        }
      }
      const match = recordName.exec(name);
      if (match?.[1] === "blob") {
        if (size !== SIDECAR_BYTES) throw Error("COMMITMENT_BLOB_CHECKSUM");
        const bytes = fs.readFileSync(path.join(directory, name));
        if (bytes.length !== SIDECAR_BYTES || `0x${createHash("sha256").update(bytes).digest("hex")}` !== match[3])
          throw Error("COMMITMENT_BLOB_CHECKSUM");
      }
    }
  }

  retain(signedBid: gloas.SignedExecutionPayloadBid, stored: StoredPayload): DurablePayload | undefined {
    const {slot, blockHash, parentBlockRoot, payload} = stored;
    const orderMetadata = parseOrderMetadata(payload.orderMetadata);
    if (!isOrderOfferAllowed(orderMetadata)) throw Error("ORDER_OFFER_TOO_EARLY");
    if (
      slot !== signedBid.message.slot ||
      slot !== payload.executionPayload.slotNumber ||
      blockHash !== toRootHex(signedBid.message.blockHash) ||
      blockHash !== toRootHex(payload.executionPayload.blockHash) ||
      toRootHex(payload.executionPayload.parentHash) !== toRootHex(signedBid.message.parentBlockHash) ||
      toRootHex(parentBlockRoot) !== toRootHex(signedBid.message.parentBlockRoot)
    )
      throw Error("COMMITMENT_PAYLOAD_MISMATCH");
    if (
      !ssz.gloas.ExecutionPayloadBid.fields.blobKzgCommitments.equals(
        signedBid.message.blobKzgCommitments,
        payload.blobsBundle.commitments
      )
    )
      throw Error("COMMITMENT_BLOB_MISMATCH");
    const executionRequestsRoot = toRootHex(ssz.gloas.ExecutionRequests.hashTreeRoot(payload.executionRequests));
    if (executionRequestsRoot !== toRootHex(signedBid.message.executionRequestsRoot))
      throw Error("COMMITMENT_EXECUTION_REQUESTS_MISMATCH");
    this.assertAdmissionCapacity(signedBid, orderMetadata);
    const payloadName = `payload-${slot}-${blockHash}.json`;
    let payloadRecord: PayloadRecord | undefined;
    if (!this.sizes.has(payloadName)) {
      const {blobs, commitments, proofs} = payload.blobsBundle;
      if (blobs.length !== commitments.length || proofs.length !== blobs.length * CELLS_PER_EXT_BLOB)
        throw Error("COMMITMENT_BLOB_SHAPE");
      const blobRefs = blobs.map((blob, i) => {
        const cellProofs = proofs.slice(i * CELLS_PER_EXT_BLOB, (i + 1) * CELLS_PER_EXT_BLOB);
        if (
          blob.length !== BLOB_BYTES ||
          commitments[i].length !== COMMITMENT_BYTES ||
          cellProofs.some((proof) => proof.length !== COMMITMENT_BYTES)
        )
          throw Error("COMMITMENT_BLOB_SHAPE");
        const bytes = Buffer.concat([blob, commitments[i], ...cellProofs]);
        const hash = `0x${createHash("sha256").update(bytes).digest("hex")}`;
        const name = `blob-${slot}-${hash}.bin`;
        if (!this.sizes.has(name)) this.writeBytes(name, bytes, true);
        return hash;
      });
      const record: PayloadRecord = {
        ...(orderMetadata === undefined ? {} : {orderMetadata}),
        slot,
        blockHash,
        parentBlockRoot: toRootHex(parentBlockRoot),
        sourceId: payload.sourceId,
        value: payload.executionPayloadValue.toString(),
        payload: payloadToJson(payload.executionPayload),
        requests: ssz.gloas.ExecutionRequests.toJson(payload.executionRequests),
        blobRefs,
      };
      this.write(payloadName, record, true);
      payloadRecord = record;
    } else {
      // The immutable file, not a fresh source response with the same hash,
      // determines what recovery can reveal for an additional signed offer.
      const reference = this.references.get(payloadName);
      let retainedParent: RootHex;
      let retainedParentRoot: RootHex;
      let retainedRequestsRoot: RootHex;
      let retainedCommitments: Uint8Array[];
      if (reference) {
        retainedParent = reference.parentBlockHash;
        retainedParentRoot = reference.parentBlockRoot;
        retainedRequestsRoot = reference.executionRequestsRoot;
        retainedCommitments = reference.commitments;
      } else {
        payloadRecord = this.read(payloadName) as PayloadRecord;
        retainedParent = toRootHex(ssz.gloas.ExecutionPayload.fromJson(payloadRecord.payload).parentHash);
        retainedParentRoot = payloadRecord.parentBlockRoot;
        retainedRequestsRoot = toRootHex(
          ssz.gloas.ExecutionRequests.hashTreeRoot(ssz.gloas.ExecutionRequests.fromJson(payloadRecord.requests))
        );
        retainedCommitments = payloadRecord.blobRefs
          ? payloadRecord.blobRefs.map((hash) =>
              fs
                .readFileSync(path.join(this.directory, `blob-${slot}-${hash}.bin`))
                .subarray(BLOB_BYTES, BLOB_BYTES + COMMITMENT_BYTES)
            )
          : ssz.gloas.BlobsBundle.fromJson(payloadRecord.blobs).commitments;
      }
      if (
        retainedParent !== toRootHex(signedBid.message.parentBlockHash) ||
        retainedParentRoot !== toRootHex(parentBlockRoot)
      )
        throw Error("COMMITMENT_PAYLOAD_MISMATCH");
      if (retainedRequestsRoot !== executionRequestsRoot) throw Error("COMMITMENT_EXECUTION_REQUESTS_MISMATCH");
      if (
        !ssz.gloas.ExecutionPayloadBid.fields.blobKzgCommitments.equals(
          retainedCommitments,
          signedBid.message.blobKzgCommitments
        )
      )
        throw Error("COMMITMENT_BLOB_MISMATCH");
    }
    this.retainBid(signedBid, orderMetadata);
    if (this.references.has(payloadName)) {
      const reference = this.references.get(payloadName);
      return reference ? {...reference, orderMetadata} : undefined;
    }
    let reference: DurablePayload | undefined;
    try {
      const record = payloadRecord ?? (this.read(payloadName) as PayloadRecord);
      // Legacy inline sidecars need the ordinary serialization path.
      if (record.blobRefs === undefined) {
        this.references.set(payloadName, undefined);
        return undefined;
      }
      const names = [payloadName, ...record.blobRefs.map((hash) => `blob-${slot}-${hash}.bin`)];
      reference = {
        orderMetadata,
        slot,
        blockHash,
        parentBlockHash: toRootHex(payload.executionPayload.parentHash),
        parentBlockRoot: toRootHex(parentBlockRoot),
        executionRequestsRoot,
        commitments: payload.blobsBundle.commitments.map((commitment) => commitment.slice()),
        files: names.map((name) => {
          const info = fs.lstatSync(path.join(this.directory, name), {bigint: true});
          if (!info.isFile()) throw Error("COMMITMENT_JOURNAL_INVALID_FILE");
          return {name, bytes: Number(info.size), dev: info.dev, ino: info.ino, mtimeNs: info.mtimeNs};
        }),
      };
    } catch {
      // The offer is already durable. An optional optimization cannot revoke
      // its acknowledgement or block reveals on a reference-metadata error.
    }
    this.references.set(payloadName, reference);
    return reference;
  }

  retainReference(signedBid: gloas.SignedExecutionPayloadBid, reference: DurablePayload): void {
    if (this.failed) throw Error("COMMITMENT_JOURNAL_FAILED");
    const orderMetadata = parseOrderMetadata(reference.orderMetadata);
    if (!isOrderOfferAllowed(orderMetadata)) throw Error("ORDER_OFFER_TOO_EARLY");
    if (!this.sharedPayloadDirectory) throw Error("COMMITMENT_REFERENCE_UNAVAILABLE");
    const {slot, blockHash, parentBlockHash, parentBlockRoot, executionRequestsRoot, commitments, files} = reference;
    if (
      slot !== signedBid.message.slot ||
      blockHash !== toRootHex(signedBid.message.blockHash) ||
      parentBlockHash !== toRootHex(signedBid.message.parentBlockHash) ||
      parentBlockRoot !== toRootHex(signedBid.message.parentBlockRoot)
    )
      throw Error("COMMITMENT_PAYLOAD_MISMATCH");
    if (executionRequestsRoot !== toRootHex(signedBid.message.executionRequestsRoot))
      throw Error("COMMITMENT_EXECUTION_REQUESTS_MISMATCH");
    if (
      !ssz.gloas.ExecutionPayloadBid.fields.blobKzgCommitments.equals(commitments, signedBid.message.blobKzgCommitments)
    )
      throw Error("COMMITMENT_BLOB_MISMATCH");
    if (files.length !== commitments.length + 1 || files[0]?.name !== `payload-${slot}-${blockHash}.json`)
      throw Error("COMMITMENT_PAYLOAD_REFERENCE");
    for (const [index, file] of files.entries()) {
      const match = recordName.exec(file.name);
      if (
        !match ||
        Number(match[2]) !== slot ||
        (index > 0 && (match[1] !== "blob" || match[4] !== "bin" || file.bytes !== SIDECAR_BYTES))
      )
        throw Error("COMMITMENT_PAYLOAD_REFERENCE");
    }
    this.assertAdmissionCapacity(signedBid, orderMetadata);
    // Blobs must be durable before linking their payload, including orphan payloads recovered after
    // a crash. A partial group also needs a barrier before an unavailable source can fall back.
    for (const filesToLink of this.sizes.has(files[0].name) ? [] : [files.slice(1), [files[0]]]) {
      let linked = false;
      try {
        for (const file of filesToLink) {
          if (this.sizes.has(file.name)) continue;
          this.assertCapacity(file.name, file.bytes);
          const filename = path.join(this.directory, file.name);
          const temporary = `${filename}.tmp`;
          // Missing/pruned source files fail this offer before publishing. Completed
          // links own their data and can safely be reused by a subsequent offer.
          try {
            fs.unlinkSync(temporary);
          } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
          }
          try {
            fs.linkSync(path.join(this.sharedPayloadDirectory, file.name), temporary);
          } catch (error) {
            throw Error("COMMITMENT_REFERENCE_UNAVAILABLE", {cause: error});
          }
          try {
            const info = fs.lstatSync(temporary, {bigint: true});
            if (
              !info.isFile() ||
              info.dev !== file.dev ||
              info.ino !== file.ino ||
              info.size !== BigInt(file.bytes) ||
              info.mtimeNs !== file.mtimeNs
            )
              throw Error("COMMITMENT_PAYLOAD_REFERENCE");
          } catch (error) {
            fs.unlinkSync(temporary);
            throw error;
          }
          try {
            fs.renameSync(temporary, filename);
            this.sizes.set(file.name, file.bytes);
            this.bytes += file.bytes;
            linked = true;
          } catch (error) {
            this.failed = true;
            throw error;
          }
        }
      } finally {
        if (linked) {
          try {
            syncDirectory(this.directory);
          } catch (error) {
            this.failed = true;
            // biome-ignore lint/correctness/noUnsafeFinally: An uncertain barrier must override a source error to forbid snapshot fallback.
            throw error;
          }
        }
      }
    }
    this.retainBid(signedBid, orderMetadata);
  }

  retainReveal(record: RevealRecord): void {
    const name = `reveal-${record.slot}-${record.blockRoot}.json`;
    if (this.sizes.has(name)) {
      if (JSON.stringify(this.read(name)) !== JSON.stringify(record)) throw Error("COMMITMENT_REVEAL_CONFLICT");
    } else this.write(name, record);
  }

  recover(currentSlot: number, payloads: PayloadStore, bids: BidStore, ledger: BidLedger): number {
    this.prune(currentSlot);
    const sidecars = new Map<string, {blob: Uint8Array; commitment: Uint8Array; proofs: Uint8Array[]}>();
    // Load all required payloads first, before any signed response can be served.
    for (const name of this.sizes.keys()) {
      if (!name.startsWith("payload-")) continue;
      const record = this.read(name) as PayloadRecord;
      const payload = ssz.gloas.ExecutionPayload.fromJson(record.payload);
      if (
        name !== `payload-${record.slot}-${record.blockHash}.json` ||
        record.slot !== payload.slotNumber ||
        record.blockHash !== toRootHex(payload.blockHash)
      )
        throw Error("COMMITMENT_PAYLOAD_MISMATCH");
      let blobsBundle: StoredPayload["payload"]["blobsBundle"];
      if (record.blobRefs !== undefined) {
        if (
          !Array.isArray(record.blobRefs) ||
          record.blobRefs.length * SIDECAR_BYTES > MAX_FILE_BYTES ||
          record.blobs !== undefined
        )
          throw Error("COMMITMENT_BLOB_SHAPE");
        blobsBundle = {blobs: [], commitments: [], proofs: []};
        for (const hash of record.blobRefs) {
          if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/.test(hash)) throw Error("COMMITMENT_BLOB_REFERENCE");
          const name = `blob-${record.slot}-${hash}.bin`;
          let sidecar = sidecars.get(name);
          if (!sidecar) {
            if (!this.sizes.has(name)) throw Error("COMMITMENT_BLOB_MISSING");
            const bytes = new Uint8Array(fs.readFileSync(path.join(this.directory, name)));
            if (bytes.length !== SIDECAR_BYTES || `0x${createHash("sha256").update(bytes).digest("hex")}` !== hash)
              throw Error("COMMITMENT_BLOB_CHECKSUM");
            sidecar = {
              blob: bytes.subarray(0, BLOB_BYTES),
              commitment: bytes.subarray(BLOB_BYTES, BLOB_BYTES + COMMITMENT_BYTES),
              proofs: Array.from({length: CELLS_PER_EXT_BLOB}, (_, i) =>
                bytes.subarray(BLOB_BYTES + (i + 1) * COMMITMENT_BYTES, BLOB_BYTES + (i + 2) * COMMITMENT_BYTES)
              ),
            };
            sidecars.set(name, sidecar);
          }
          blobsBundle.blobs.push(sidecar.blob);
          blobsBundle.commitments.push(sidecar.commitment);
          blobsBundle.proofs.push(...sidecar.proofs);
        }
      } else {
        blobsBundle = ssz.gloas.BlobsBundle.fromJson(record.blobs);
      }
      payloads.add(
        {
          slot: record.slot,
          parentBlockRoot: fromHex(record.parentBlockRoot),
          blockHash: record.blockHash,
          payload: {
            sourceId: record.sourceId,
            orderMetadata: recoverOrderMetadata(record.orderMetadata),
            executionPayload: payload,
            executionPayloadValue: BigInt(record.value),
            executionRequests: ssz.gloas.ExecutionRequests.fromJson(record.requests),
            blobsBundle,
          },
        },
        "recovery"
      );
    }
    let recovered = 0;
    for (const name of this.sizes.keys()) {
      if (!name.startsWith("bid-")) continue;
      const decoded = decodeBidRecord(this.read(name));
      const {signed} = decoded;
      const bid = signed.message;
      const signedBidRoot = toRootHex(ssz.gloas.SignedExecutionPayloadBid.hashTreeRoot(signed));
      if (name !== bidRecordName(decoded)) throw Error("COMMITMENT_BID_MISMATCH");
      const identity = {
        slot: bid.slot,
        parentBlockRoot: toRootHex(bid.parentBlockRoot),
        parentBlockHash: toRootHex(bid.parentBlockHash),
        blockHash: toRootHex(bid.blockHash),
        signedBidRoot,
        valueGwei: bid.value,
      };
      ledger.recordRevision(identity);
      if (!ledger.hasSubmitted(bid.slot, identity.parentBlockHash, identity.parentBlockRoot))
        ledger.recordBid(identity);
      ledger.reserveRecoveredSlot(bid.slot, bid.value);
      if (bid.slot + PAYLOAD_RETENTION_SLOTS >= currentSlot) {
        const payload = payloads.get(identity.blockHash);
        if (
          !payload ||
          payload.slot !== bid.slot ||
          toRootHex(payload.parentBlockRoot) !== identity.parentBlockRoot ||
          toRootHex(payload.payload.executionPayload.parentHash) !== identity.parentBlockHash
        )
          throw Error("COMMITMENT_PAYLOAD_MISSING");
        if (
          !ssz.gloas.ExecutionPayloadBid.fields.blobKzgCommitments.equals(
            bid.blobKzgCommitments,
            payload.payload.blobsBundle.commitments
          )
        )
          throw Error("COMMITMENT_BLOB_MISMATCH");
        if (
          toRootHex(ssz.gloas.ExecutionRequests.hashTreeRoot(payload.payload.executionRequests)) !==
          toRootHex(bid.executionRequestsRoot)
        )
          throw Error("COMMITMENT_EXECUTION_REQUESTS_MISMATCH");
        bids.add(signed, "recovery", decoded.metadata);
      }
      recovered++;
    }
    for (const name of this.sizes.keys()) {
      if (!name.startsWith("reveal-")) continue;
      const record = this.read(name) as RevealRecord;
      if (name !== `reveal-${record.slot}-${record.blockRoot}.json`) throw Error("COMMITMENT_REVEAL_MISMATCH");
      ledger.recordReveal(record.slot, record.blockRoot, record.blockHash, record.envelopeRoot);
    }
    return recovered;
  }

  prune(currentSlot: number): void {
    const pruneBoundary = this.checkExposureClock();
    for (const name of this.sizes.keys()) {
      const match = recordName.exec(name);
      if (
        !match ||
        Number(match[2]) + (match[1] === "payload" || match[1] === "blob" ? PAYLOAD_RETENTION_SLOTS : KEEP_SLOTS) >=
          currentSlot
      )
        continue;
      if (match[1] === "bid") {
        const record = this.exposure.get(name);
        const ids = record?.metadata?.orderIds;
        if (ids && record?.commitment && !this.exposureIncomplete) {
          for (const id of ids) {
            if (!this.forgottenOrderIds.has(id) && this.forgottenOrderIds.size === MAX_FORGOTTEN_ORDER_IDS) {
              this.exposureIncomplete = true;
              break;
            }
            this.forgottenOrderIds.add(id);
          }
        }
        if (!ids || !record?.commitment || this.exposureIncomplete) {
          this.prunedThroughUnixMs = Math.max(
            this.prunedThroughUnixMs,
            record?.commitment?.possibleExposureAtUnixMs ?? 0,
            pruneBoundary
          );
        }
        // Lost exact IDs cannot regain absence through a later admission bound.
        if (this.exposureIncomplete) this.forgottenOrderIds.clear();
        this.exposureBytes -= record?.bytes ?? 0;
        this.exposure.delete(name);
      }
      fs.unlinkSync(path.join(this.directory, name));
      const bytes = this.sizes.get(name) ?? 0;
      this.bytes -= bytes;
      if (match[1] === "reveal") {
        this.revealBytes -= bytes;
        this.revealFiles--;
      }
      this.sizes.delete(name);
      if (match[1] === "bid") {
        const slot = Number(match[2]);
        const remaining = (this.admissionsBySlot.get(slot) ?? 1) - 1;
        if (remaining > 0) this.admissionsBySlot.set(slot, remaining);
        else this.admissionsBySlot.delete(slot);
      }
      this.references.delete(name);
    }
    // Unsynced deletion can only restore expired records after a crash. Recovery
    // prunes by slot before serving; it never makes expired offers eligible again.
  }

  hasExposureCoverage(): boolean {
    return !this.failed && !this.exposureIncomplete;
  }

  queryExposure(orderId: string, admittedAtUnixMs: number): JournalExposure {
    this.checkExposureClock();
    let coverageComplete =
      !this.failed &&
      !this.exposureIncomplete &&
      admittedAtUnixMs > this.prunedThroughUnixMs &&
      !this.forgottenOrderIds.has(orderId);
    const commitments: OrderCommitment[] = [];
    let commitmentCount = 0;
    for (const {metadata, commitment} of this.exposure.values()) {
      if (!metadata || metadata.orderIds === null || !commitment) coverageComplete = false;
      if (metadata?.orderIds?.includes(orderId)) {
        commitmentCount++;
        if (!commitment) continue;
        if (
          commitments.length < MAX_EXPOSURE_COMMITMENTS ||
          commitment.possibleExposureAtUnixMs < (commitments.at(-1)?.possibleExposureAtUnixMs ?? Infinity)
        ) {
          commitments.push(commitment);
          commitments.sort((a, b) => a.possibleExposureAtUnixMs - b.possibleExposureAtUnixMs);
          if (commitments.length > MAX_EXPOSURE_COMMITMENTS) commitments.pop();
        }
      }
    }
    commitments.sort((a, b) => a.possibleExposureAtUnixMs - b.possibleExposureAtUnixMs);
    return {coverageComplete, commitmentCount, commitments};
  }

  private retainBid(signed: gloas.SignedExecutionPayloadBid, metadata: OrderMetadata | undefined): void {
    if (!isOrderOfferAllowed(metadata)) throw Error("ORDER_OFFER_TOO_EARLY");
    this.checkExposureClock();
    const root = toRootHex(ssz.gloas.SignedExecutionPayloadBid.hashTreeRoot(signed));
    let name = `bid-${signed.message.slot}-${root}.json`;
    let version = 2;
    if (this.sizes.has(name)) {
      if (sameOrderMetadata(decodeBidRecord(this.read(name)).metadata, metadata)) return;
      version = 3;
      name = bidRecordName({signed, metadata, version});
      if (this.sizes.has(name)) {
        const prior = decodeBidRecord(this.read(name));
        if (bidRecordName(prior) !== name || !sameOrderMetadata(prior.metadata, metadata))
          throw Error("ORDER_METADATA_CONFLICT");
        return;
      }
    }
    const count = this.admissionsBySlot.get(signed.message.slot) ?? 0;
    this.assertAdmissionCapacity(signed, metadata);
    // The original signature's attribution and exposure time are never rewritten.
    // A fresh authorization for identical signed bytes is a separate admission.
    const data = {
      version,
      signedBid: ssz.gloas.SignedExecutionPayloadBid.toJson(signed),
      orderMetadata: metadata,
      possibleExposureAtUnixMs: Date.now(),
    };
    this.write(name, data);
    this.admissionsBySlot.set(signed.message.slot, count + 1);
    this.indexExposure(name, data, this.sizes.get(name) ?? 0);
  }

  /** A definite refusal before any payload, blob, link or bid write. Exact durable
   * retries remain allowed; all journal mutations run serially on one owner. */
  private assertAdmissionCapacity(signed: gloas.SignedExecutionPayloadBid, metadata: OrderMetadata | undefined): void {
    if ((this.admissionsBySlot.get(signed.message.slot) ?? 0) < MAX_BID_REVISIONS_PER_SLOT) return;
    const root = toRootHex(ssz.gloas.SignedExecutionPayloadBid.hashTreeRoot(signed));
    const original = `bid-${signed.message.slot}-${root}.json`;
    if (this.sizes.has(original)) {
      if (sameOrderMetadata(decodeBidRecord(this.read(original)).metadata, metadata)) return;
      const name = bidRecordName({signed, metadata, version: 3});
      if (this.sizes.has(name)) {
        const prior = decodeBidRecord(this.read(name));
        if (bidRecordName(prior) !== name || !sameOrderMetadata(prior.metadata, metadata))
          throw Error("ORDER_METADATA_CONFLICT");
        return;
      }
    }
    throw new CommitmentJournalError("COMMITMENT_SLOT_ADMISSION_LIMIT", false);
  }

  private checkExposureClock(): number {
    const now = Date.now();
    const expected = this.exposureClock.unix + performance.now() - this.exposureClock.monotonic;
    if (now < this.lastExposureUnixMs || Math.abs(now - expected) > EXPOSURE_CLOCK_TOLERANCE_MS)
      this.exposureIncomplete = true;
    this.lastExposureUnixMs = now;
    // Cover both publisher/worker clock tolerances and millisecond rounding. A prune cannot
    // make a prior admission look newer merely because a signed record was backdated.
    return Math.ceil(Math.max(now, expected) + 2 * EXPOSURE_CLOCK_TOLERANCE_MS + 2);
  }

  private indexExposure(name: string, data: unknown, bytes: number): void {
    if (
      bytes > MAX_EXPOSURE_FILE_BYTES ||
      this.exposure.size >= MAX_FILES ||
      this.exposureBytes + bytes > MAX_EXPOSURE_BYTES
    ) {
      this.exposureIncomplete = true;
      return;
    }
    const decoded = decodeBidRecord(data);
    const {signed, metadata, time} = decoded;
    const bid = signed.message;
    const root = toRootHex(ssz.gloas.SignedExecutionPayloadBid.hashTreeRoot(signed));
    if (name !== bidRecordName(decoded)) throw Error("COMMITMENT_BID_MISMATCH");
    this.exposure.set(name, {
      metadata,
      bytes,
      commitment:
        time === null
          ? null
          : {
              network: this.identity.genesisValidatorsRoot,
              slot: bid.slot,
              builderIndex: bid.builderIndex,
              parentBlockRoot: toRootHex(bid.parentBlockRoot),
              parentBlockHash: toRootHex(bid.parentBlockHash),
              blockHash: toRootHex(bid.blockHash),
              signedBidRoot: root,
              possibleExposureAtUnixMs: time,
            },
    });
    this.exposureBytes += bytes;
  }

  private read(name: string): unknown {
    const {data, checksum} = JSON.parse(fs.readFileSync(path.join(this.directory, name), "utf8")) as {
      data: unknown;
      checksum: string;
    };
    if (digest(JSON.stringify(data)) !== checksum) throw Error("COMMITMENT_JOURNAL_CHECKSUM");
    return data;
  }

  private write(name: string, data: unknown, sharePayload = false): void {
    const json = JSON.stringify(data);
    const text = `{"data":${json},"checksum":"${digest(json)}"}`;
    this.writeBytes(name, Buffer.from(text), sharePayload);
  }

  private writeBytes(name: string, data: Uint8Array, sharePayload = false): void {
    if (this.failed) throw Error("COMMITMENT_JOURNAL_FAILED");
    const bytes = data.byteLength;
    this.assertCapacity(name, bytes);
    const filename = path.join(this.directory, name);
    const temporary = `${filename}.tmp`;
    try {
      try {
        fs.unlinkSync(temporary);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      let linked = false;
      if (sharePayload && this.sharedPayloadDirectory !== undefined) {
        try {
          fs.linkSync(path.join(this.sharedPayloadDirectory, name), temporary);
          linked = true;
        } catch (error) {
          // Linking is optional; an existing target would violate the single-writer contract.
          if (!(error instanceof Error && "code" in error && error.code !== "EEXIST")) throw error;
        }
        if (linked) {
          let matches = false;
          try {
            const info = fs.lstatSync(temporary);
            matches = info.isFile() && info.size === bytes && fs.readFileSync(temporary).equals(data);
          } catch {
            // An unreadable source is no reason to lose the independently retained in-memory snapshot.
          }
          if (!matches) {
            fs.unlinkSync(temporary);
            linked = false;
          }
        }
      }
      if (!linked) {
        const fd = fs.openSync(temporary, "wx", 0o600);
        try {
          fs.writeFileSync(fd, data);
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
      }
      fs.renameSync(temporary, filename);
      // Source files are immutable and already synced before a stage can borrow them. This identity's
      // durable hard link owns its reveal lifetime independently of source pruning or restart order.
      syncDirectory(this.directory);
      this.sizes.set(name, bytes);
      this.bytes += bytes;
      if (name.startsWith("reveal-")) {
        this.revealBytes += bytes;
        this.revealFiles++;
      }
    } catch (error) {
      this.failed = true;
      throw error;
    }
  }

  private assertCapacity(name: string, bytes: number): void {
    const reveal = name.startsWith("reveal-");
    if (reveal && bytes > MAX_REVEAL_RECORD_BYTES) throw Error("COMMITMENT_REVEAL_SIZE");
    // Existing reveal files consume the reserve. New offers cannot occupy its
    // remaining quota, including after recovery or an incomplete failed offer.
    const reservedBytes = reveal ? 0 : Math.max(0, RESERVED_REVEAL_BYTES - this.revealBytes);
    const reservedFiles = reveal ? 0 : Math.max(0, RESERVED_REVEAL_FILES - this.revealFiles);
    if (
      bytes > MAX_FILE_BYTES ||
      this.bytes + bytes > MAX_BYTES - reservedBytes ||
      this.sizes.size >= MAX_FILES - reservedFiles
    )
      throw Error("COMMITMENT_JOURNAL_CAPACITY");
  }
}

function payloadToJson(payload: gloas.ExecutionPayload): Record<string, unknown> {
  const json: Record<string, unknown> = {};
  for (const {fieldName, fieldType, jsonKey} of ssz.gloas.ExecutionPayload.fieldsEntries) {
    // Keep SSZ field order and encoding identical for checksums, shared files and older readers.
    if (fieldName === "transactions") json[jsonKey] = Array.from(payload.transactions, (tx) => toHex(tx));
    else if (fieldName === "blockAccessList") json[jsonKey] = toHex(payload.blockAccessList);
    else json[jsonKey] = (fieldType as Type<unknown>).toJson(payload[fieldName]);
  }
  return json;
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function ensureCommitmentDirectory(directory: string): void {
  const created = fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  if (created) {
    // A synced record directory alone does not persist its newly created ancestors.
    const last = path.dirname(path.resolve(created));
    for (let parent = path.dirname(path.resolve(directory)); ; parent = path.dirname(parent)) {
      syncDirectory(parent);
      if (parent === last) break;
    }
  }
}

function syncDirectory(directory: string): void {
  const fd = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function decodeBidRecord(value: unknown): {
  signed: gloas.SignedExecutionPayloadBid;
  metadata?: OrderMetadata;
  time: number | null;
  version: number;
} {
  const record = value as {
    version?: unknown;
    signedBid?: unknown;
    orderMetadata?: unknown;
    possibleExposureAtUnixMs?: unknown;
  };
  if (record?.version === 2 || record?.version === 3) {
    const validTime =
      Number.isSafeInteger(record.possibleExposureAtUnixMs) && (record.possibleExposureAtUnixMs as number) >= 0;
    return {
      signed: ssz.gloas.SignedExecutionPayloadBid.fromJson(record.signedBid),
      version: record.version,
      metadata:
        record.version === 3 ? parseOrderMetadata(record.orderMetadata) : recoverOrderMetadata(record.orderMetadata),
      time: validTime ? (record.possibleExposureAtUnixMs as number) : null,
    };
  }
  if (record?.version !== undefined) throw Error("COMMITMENT_BID_UNSUPPORTED_VERSION");
  return {signed: ssz.gloas.SignedExecutionPayloadBid.fromJson(value), time: null, version: 1};
}

function recoverOrderMetadata(value: unknown): OrderMetadata | undefined {
  try {
    return parseOrderMetadata(value);
  } catch {
    return undefined;
  }
}

function bidRecordName(record: {
  signed: gloas.SignedExecutionPayloadBid;
  metadata?: OrderMetadata;
  version: number;
}): string {
  const root = toRootHex(ssz.gloas.SignedExecutionPayloadBid.hashTreeRoot(record.signed));
  const key =
    record.version === 3 ? `0x${digest(`order-offer-v3:${root}:${JSON.stringify(record.metadata ?? null)}`)}` : root;
  return `bid-${record.signed.message.slot}-${key}.json`;
}
