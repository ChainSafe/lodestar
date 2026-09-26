import {ContainerType, UintNumberType} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {Db, encodeKey} from "@lodestar/db";
import {GENESIS_SLOT} from "@lodestar/params";
import {RootHex, Slot} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getSignedBlockTypeFromBytes} from "../util/multifork.js";
import {getSlotFromSignedBeaconBlockSerialized} from "../util/sszBytes.js";
import {Bucket} from "./buckets.js";
import {BlockRepository} from "./repositories/block.js";
import {BlockArchiveRepository} from "./repositories/blockArchive.js";

/**
 * Present while no build without this certification has started since it was written. The downgrade contract covers
 * builds from v1.3 (December 2022) on: each start runs `pruneHotDb`, which deletes every key of the hot blob sidecar
 * bucket, and that bucket's key decoding accepts this id. This build's prune keeps the key.
 * A build older than v1.3 keeps it too, so a downgrade to one is not detected.
 */
export const WRITER_CANARY_ID = Buffer.from("serving-block-certification");
const WRITER_CANARY_KEY = encodeKey(Bucket.deneb_blobSidecars, WRITER_CANARY_ID);
/** The archive slots [from, to] whose stored blocks may exceed maxPayloadSize; empty when from > to */
const UNVERIFIED_KEY = encodeKey(Bucket.index_servingBlockCertification, "unverified");
const markerType = new ContainerType({
  maxPayloadSize: new UintNumberType(8),
  from: new UintNumberType(8),
  to: new UintNumberType(8),
});
type Interval = {from: Slot; to: Slot};
const NONE: Interval = {from: 1, to: 0};

export type OversizedBlock = {slot: Slot | null; root: RootHex | null; bytes: number};

/**
 * Which stored blocks serving may read with stock reads: blocks within MAX_PAYLOAD_SIZE by their writers or by
 * verification. Every current block writer is capped: gossip and req/resp decoding, local publication, genesis, and
 * finalization, which copies hot rows and marks any oversized one unverified. Rows written before this certification,
 * by a build without it, or under another MAX_PAYLOAD_SIZE are unverified until `verifyArchive` reads them.
 *
 * No archive block is certified until this run's `scanHot` succeeds: finalization could otherwise copy an oversized hot
 * block into a slot that a pending stock read already selected as verified.
 */
export class ServingBlockCertification {
  /** Whether every hot block fitted MAX_PAYLOAD_SIZE when this process scanned them; later hot writes are capped */
  hotVerified = false;
  private unverified: Interval = {from: 0, to: Infinity};
  private loaded = false;

  constructor(
    private readonly config: ChainForkConfig,
    private readonly db: Db,
    private readonly block: BlockRepository,
    private readonly blockArchive: BlockArchiveRepository
  ) {}

  /** The unverified archive slots, null when there are none */
  get unverifiedArchive(): Interval | null {
    return this.unverified.from > this.unverified.to ? null : {...this.unverified};
  }

  isArchiveSlotVerified(slot: Slot): boolean {
    return this.hotVerified && (slot < this.unverified.from || slot > this.unverified.to);
  }

  /** Whether every archive slot in [start, end] is verified */
  isArchiveRangeVerified(start: Slot, end: Slot): boolean {
    const {from, to} = this.unverified;
    return this.hotVerified && (from > to || end < from || start > to || end < start);
  }

  /**
   * Loads the unverified archive slots. A new certification, one that a build without it may have written past, or one
   * verified under another MAX_PAYLOAD_SIZE marks every archived block unverified except genesis, which only the
   * genesis block can fill.
   */
  async load(): Promise<Interval | null> {
    const [marker, canary] = await Promise.all([this.db.get(UNVERIFIED_KEY), this.db.get(WRITER_CANARY_KEY)]);
    const certified =
      marker !== null && canary !== null && marker.length === markerType.fixedSize
        ? markerType.deserialize(marker)
        : null;
    if (certified !== null && certified.maxPayloadSize === this.config.MAX_PAYLOAD_SIZE) {
      this.unverified = {from: certified.from, to: certified.to};
    } else {
      const [[first], last] = await Promise.all([
        this.blockArchive.keys({gte: GENESIS_SLOT + 1, limit: 1}),
        this.blockArchive.lastKey(),
      ]);
      const unverified = first === undefined || last === null || last < first ? NONE : {from: first, to: last};
      await this.db.batchPut([
        {key: UNVERIFIED_KEY, value: this.serialize(unverified)},
        {key: WRITER_CANARY_KEY, value: new Uint8Array([1])},
      ]);
      this.unverified = unverified;
    }
    this.loaded = true;
    return this.unverifiedArchive;
  }

  /**
   * Reads every hot block once, one at a time outside the block cache, and stops at the first oversized one. This
   * startup maintenance runs outside the serving lease and bounds concurrent rows, not bytes: the size check follows
   * allocation, so memory follows the largest stored row.
   */
  async scanHot(): Promise<OversizedBlock | null> {
    this.hotVerified = false;
    for await (const {key, value} of this.block.binaryEntriesStream({fillCache: false, rowAtATime: true})) {
      if (value.byteLength > this.config.MAX_PAYLOAD_SIZE) {
        return {
          slot: getSlotFromSignedBeaconBlockSerialized(value),
          root: toRootHex(this.block.decodeKey(key)),
          bytes: value.byteLength,
        };
      }
    }
    this.hotVerified = true;
    return null;
  }

  /** Marks the slots of archived blocks above MAX_PAYLOAD_SIZE unverified; call before writing them */
  async unverifyOversized(blocks: {slot: Slot; bytes: number}[]): Promise<void> {
    if (!this.loaded) await this.load();
    let next = this.unverified;
    for (const {slot, bytes} of blocks) {
      if (bytes <= this.config.MAX_PAYLOAD_SIZE) continue;
      next =
        next.from > next.to ? {from: slot, to: slot} : {from: Math.min(next.from, slot), to: Math.max(next.to, slot)};
    }
    if (next !== this.unverified) await this.persist(next);
  }

  /**
   * Verifies the unverified archived blocks in slot order, one at a time outside the block cache, recording progress
   * every `persistEvery` blocks so a later run resumes. Stops at the first block above MAX_PAYLOAD_SIZE, which stays
   * unverified with every later slot. Like `scanHot`, it bounds concurrent rows, not bytes.
   */
  async verifyArchive({
    persistEvery = 1024,
    onProgress,
  }: {
    persistEvery?: number;
    onProgress?: (slot: Slot) => void;
  } = {}): Promise<OversizedBlock | null> {
    if (!this.loaded) await this.load();
    const {from, to} = this.unverified;
    if (from > to) return null;
    let blocks = 0;
    for await (const {key, value} of this.blockArchive.binaryEntriesStream({
      fillCache: false,
      rowAtATime: true,
      gte: from,
      lte: to,
    })) {
      const slot = this.blockArchive.decodeKey(key);
      if (value.byteLength > this.config.MAX_PAYLOAD_SIZE) {
        await this.persist({from: slot, to});
        return {slot, root: this.rootOf(slot, value), bytes: value.byteLength};
      }
      if (++blocks % persistEvery === 0) {
        await this.persist({from: slot + 1, to});
        onProgress?.(slot);
      }
    }
    await this.persist(NONE);
    return null;
  }

  private async persist(unverified: Interval): Promise<void> {
    const next = unverified.from > unverified.to ? NONE : unverified;
    await this.db.put(UNVERIFIED_KEY, this.serialize(next));
    this.unverified = next;
  }

  private serialize({from, to}: Interval): Uint8Array {
    return markerType.serialize({maxPayloadSize: this.config.MAX_PAYLOAD_SIZE, from, to});
  }

  private rootOf(slot: Slot, bytes: Uint8Array): RootHex | null {
    try {
      const block = getSignedBlockTypeFromBytes(this.config, bytes).deserialize(bytes);
      return toRootHex(this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message));
    } catch {
      return null;
    }
  }
}
