import {createHash} from "node:crypto";
import {CELLS_PER_EXT_BLOB, FIELD_ELEMENTS_PER_BLOB, ForkPostGloas} from "@lodestar/params";
import {BlobsBundle, ExecutionPayload, Root, RootHex, Slot, gloas, ssz} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";
import {MAX_RETAINED_PAYLOADS, PAYLOAD_RETENTION_SLOTS} from "./commitmentLimits.js";
import type {OfferEligibility} from "./offerEligibility.js";
import {type OrderMetadata, isOrderOfferAllowed, parseOrderMetadata} from "./orderMetadata.js";

// NOTE: BuiltPayload will migrate to payloadSource.ts when the payload source lands; the store
// holds it here for now.
export type BuiltPayload = {
  orderMetadata?: OrderMetadata;
  sourceId: string;
  executionPayload: ExecutionPayload<ForkPostGloas>;
  executionRequests: gloas.ExecutionRequests;
  blobsBundle: BlobsBundle<ForkPostGloas>;
  /** Value of the payload to the fee recipient in wei, as reported by the execution client */
  executionPayloadValue: bigint;
  offerEligibility?: OfferEligibility;
};

export type StoredPayload = {
  slot: Slot;
  parentBlockRoot: Root;
  blockHash: RootHex;
  payload: BuiltPayload;
};

/** Keep payloads for this many slots after their target slot, late blocks may still commit to them */
const KEEP_SLOTS = PAYLOAD_RETENTION_SLOTS;
const BLOB_BYTES = FIELD_ELEMENTS_PER_BLOB * 32;
type Sidecar = {blob: Uint8Array; commitment: Uint8Array; proofs: Uint8Array[]};

export class PayloadStoreCapacityError extends LodestarError<{
  code: "PAYLOAD_STORE_CAPACITY";
  bytes: number;
  count: number;
  slot: Slot;
  slotBytes: number;
  maxSlotBytes: number;
}> {}

export class PayloadStore {
  private readonly byBlockHash = new Map<RootHex, StoredPayload>();
  private readonly sizes = new Map<RootHex, number>();
  private readonly bytesBySlot = new Map<Slot, number>();
  private readonly blobsBySlot = new Map<Slot, Map<string, Sidecar>>();
  private retainedBytes = 0;

  constructor(
    private readonly maxBytes = 256 * 1024 * 1024,
    private readonly maxPayloads = MAX_RETAINED_PAYLOADS
  ) {}

  add(payload: StoredPayload, admission: "offer" | "recovery" | "alternate" = "offer"): StoredPayload {
    const metadata = parseOrderMetadata(payload.payload.orderMetadata);
    if (admission !== "recovery" && !isOrderOfferAllowed(metadata)) throw Error("ORDER_OFFER_TOO_EARLY");
    const previous = this.byBlockHash.get(payload.blockHash);
    if (previous) {
      if (
        previous.slot !== payload.slot ||
        !ssz.Root.equals(previous.parentBlockRoot, payload.parentBlockRoot) ||
        (previous.payload.executionPayload !== payload.payload.executionPayload &&
          !ssz.gloas.ExecutionPayload.equals(previous.payload.executionPayload, payload.payload.executionPayload)) ||
        (previous.payload.executionRequests !== payload.payload.executionRequests &&
          !ssz.gloas.ExecutionRequests.equals(previous.payload.executionRequests, payload.payload.executionRequests)) ||
        (previous.payload.blobsBundle !== payload.payload.blobsBundle &&
          !ssz.gloas.BlobsBundle.equals(previous.payload.blobsBundle, payload.payload.blobsBundle))
      )
        throw Error("PAYLOAD_STORE_BODY_CONFLICT");
      // Attribution belongs to this admission, while the original reveal body stays immutable.
      return {
        ...payload,
        payload: {
          ...payload.payload,
          orderMetadata: metadata,
          executionPayload: previous.payload.executionPayload,
          executionRequests: previous.payload.executionRequests,
          blobsBundle: previous.payload.blobsBundle,
        },
      };
    }
    if (metadata !== undefined) payload = {...payload, payload: {...payload.payload, orderMetadata: metadata}};
    const {executionPayload, executionRequests, blobsBundle} = payload.payload;
    const existing = this.blobsBySlot.get(payload.slot);
    const added = new Map<string, Sidecar>();
    const shared: BuiltPayload["blobsBundle"] = {blobs: [], commitments: [], proofs: []};
    if (
      blobsBundle.blobs.length !== blobsBundle.commitments.length ||
      blobsBundle.proofs.length !== blobsBundle.blobs.length * CELLS_PER_EXT_BLOB
    )
      throw Error("PAYLOAD_STORE_BLOB_SHAPE");
    for (let i = 0; i < blobsBundle.blobs.length; i++) {
      const blob = blobsBundle.blobs[i];
      const commitment = blobsBundle.commitments[i];
      const proofs = blobsBundle.proofs.slice(i * CELLS_PER_EXT_BLOB, (i + 1) * CELLS_PER_EXT_BLOB);
      if (blob.length !== BLOB_BYTES || commitment.length !== 48 || proofs.some((proof) => proof.length !== 48))
        throw Error("PAYLOAD_STORE_BLOB_SHAPE");
      const digest = createHash("sha256").update(blob).update(commitment);
      for (const proof of proofs) digest.update(proof);
      const key = digest.digest("hex");
      let sidecar = existing?.get(key) ?? added.get(key);
      if (!sidecar) {
        sidecar = {blob, commitment, proofs};
        added.set(key, sidecar);
      }
      shared.blobs.push(sidecar.blob);
      shared.commitments.push(sidecar.commitment);
      shared.proofs.push(...sidecar.proofs);
    }
    const bytes =
      ssz.gloas.ExecutionPayload.value_serializedSize(executionPayload) +
      ssz.gloas.ExecutionRequests.value_serializedSize(executionRequests) +
      ssz.gloas.BlobsBundle.value_serializedSize(blobsBundle) +
      1024 +
      (metadata?.orderIds?.length ?? 0) * 68 -
      blobsBundle.blobs.length * BLOB_BYTES;
    const additionalBytes = bytes + added.size * BLOB_BYTES;
    const slotBytes = this.bytesBySlot.get(payload.slot) ?? 0;
    const fraction = admission === "alternate" ? 2 : 1;
    const maxSlotBytes = Math.floor(this.maxBytes / ((PAYLOAD_RETENTION_SLOTS + 2) * fraction));
    // Recovery must retain commitments made before the per-slot admission budget existed.
    if (
      this.retainedBytes + additionalBytes > Math.floor(this.maxBytes / fraction) ||
      this.byBlockHash.size >= Math.floor(this.maxPayloads / fraction) ||
      (admission !== "recovery" && slotBytes + additionalBytes > maxSlotBytes)
    ) {
      // Never evict a previously advertised payload to make room for a newer offer.
      throw new PayloadStoreCapacityError({
        code: "PAYLOAD_STORE_CAPACITY",
        bytes: this.retainedBytes,
        count: this.byBlockHash.size,
        slot: payload.slot,
        slotBytes,
        maxSlotBytes,
      });
    }
    // All payloads in a slot have the same expiry. Sharing immutable sidecars
    // cannot shorten an older revision's reveal lifetime. Stage admission before
    // changing either cache; a rejected revision retains no sidecar ownership.
    if (shared.blobs.length) {
      const cache = existing ?? new Map<string, Sidecar>();
      for (const [key, sidecar] of added) cache.set(key, sidecar);
      this.blobsBySlot.set(payload.slot, cache);
      payload = {...payload, payload: {...payload.payload, blobsBundle: shared}};
    }
    this.byBlockHash.set(payload.blockHash, payload);
    this.sizes.set(payload.blockHash, bytes);
    this.retainedBytes += additionalBytes;
    this.bytesBySlot.set(payload.slot, slotBytes + additionalBytes);
    return payload;
  }

  get(blockHash: RootHex): StoredPayload | null {
    return this.byBlockHash.get(blockHash) ?? null;
  }

  has(blockHash: RootHex): boolean {
    return this.byBlockHash.has(blockHash);
  }

  /** Cheap preflight only; add() still checks the incoming payload's full size. */
  hasCapacityForAlternate(slot: Slot): boolean {
    return (
      this.retainedBytes < Math.floor(this.maxBytes / 2) &&
      this.byBlockHash.size < Math.floor(this.maxPayloads / 2) &&
      (this.bytesBySlot.get(slot) ?? 0) < Math.floor(this.maxBytes / ((PAYLOAD_RETENTION_SLOTS + 2) * 2))
    );
  }

  prune(currentSlot: Slot): void {
    for (const [blockHash, {slot}] of this.byBlockHash) {
      if (slot + KEEP_SLOTS < currentSlot) {
        this.byBlockHash.delete(blockHash);
        this.retainedBytes -= this.sizes.get(blockHash) ?? 0;
        this.sizes.delete(blockHash);
        this.bytesBySlot.delete(slot);
      }
    }
    for (const [slot, blobs] of this.blobsBySlot) {
      if (slot + KEEP_SLOTS < currentSlot) {
        this.retainedBytes -= blobs.size * BLOB_BYTES;
        this.blobsBySlot.delete(slot);
      }
    }
  }

  get size(): number {
    return this.byBlockHash.size;
  }

  /** Unique blob bytes per slot, serialized remaining content and per-entry
   * allowances. Commitments/proofs stay conservatively charged per revision.
   * This is retained-content accounting, not process RSS. */
  get bytes(): number {
    return this.retainedBytes;
  }
}
