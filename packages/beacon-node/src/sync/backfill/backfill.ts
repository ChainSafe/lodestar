import {BeaconConfig} from "@lodestar/config";
import {ForkPostFulu, GENESIS_EPOCH, GENESIS_SLOT, SLOTS_PER_EPOCH, isForkPostFulu} from "@lodestar/params";
import {ISignatureSet, computeStartSlotAtEpoch, getBlobDataRetentionStartEpoch} from "@lodestar/state-transition";
import {
  BuilderIndex,
  ColumnIndex,
  DataColumnSidecar,
  Root,
  RootHex,
  SignedBeaconBlock,
  Slot,
  gloas,
  isGloasBeaconBlock,
  isGloasDataColumnSidecar,
  ssz,
} from "@lodestar/types";
import {Logger, byteArrayEquals, prettyPrintIndices, sleep, toRootHex} from "@lodestar/utils";
import {DataColumnSidecarValidationError} from "../../chain/errors/dataColumnSidecarError.js";
import {IBeaconChain} from "../../chain/index.js";
import {IBeaconDb} from "../../db/index.js";
import {Metrics} from "../../metrics/index.js";
import {INetwork, PeerAction} from "../../network/index.js";
import {PeerSyncMeta} from "../../network/peers/peersData.js";
import {IClock} from "../../util/clock.js";
import {CustodyConfig, getBlobKzgCommitments} from "../../util/dataColumns.js";
import {PeerIdStr} from "../../util/peerId.js";
import {shuffle} from "../../util/shuffle.js";
import {
  DownloadByRangeError,
  validateColumnsByRangeResponse,
  validateEnvelopesByRangeResponse,
} from "../utils/downloadByRange.js";
import {BackfillSyncError, BackfillSyncErrorCode} from "./errors.js";
import {
  BackfillBlock,
  assertEnvelopeConsistency,
  assertLinearChainToRoot,
  getBackfillEnvelopeSignatureSet,
  verifyProposerSignatures,
} from "./verify.js";

/** Pause between batches so backfill never competes with head processing for long */
const BATCH_INTERVAL_MS = 1000;
/** Time a peer is skipped after failing to serve a batch */
const PEER_COOLDOWN_MS = 60_000;
/** Custody columns of a batch may have to be collected from several peers */
const MAX_COLUMN_REQUESTS_PER_BATCH = 16;

export enum BackfillSyncStatus {
  /** Node is not synced, or nothing is archived above the earliest available slot yet */
  Waiting = "Waiting",
  Syncing = "Syncing",
  /** Earliest available slot is at or below the backfill target */
  Completed = "Completed",
}

/** Map a BackfillSyncStatus to an integer for rendering in Grafana */
export const backfillSyncStatusMetric: {[K in BackfillSyncStatus]: number} = {
  [BackfillSyncStatus.Waiting]: 0,
  [BackfillSyncStatus.Syncing]: 1,
  [BackfillSyncStatus.Completed]: 2,
};

export enum BackfillBatchStep {
  blocks = "blocks",
  envelopes = "envelopes",
  columns = "columns",
  persist = "persist",
}

export type BackfillSyncModules = {
  config: BeaconConfig;
  chain: Pick<IBeaconChain, "bls" | "earliestAvailableSlot"> & {
    clock: Pick<IClock, "currentEpoch" | "currentSlot">;
    custodyConfig: Pick<CustodyConfig, "custodyColumns" | "targetCustodyGroupCount">;
    pubkeyCache: Pick<IBeaconChain["pubkeyCache"], "size">;
  };
  db: Pick<IBeaconDb, "blockArchive" | "dataColumns" | "earliestAvailableSlot" | "executionPayloadEnvelopeArchive">;
  network: Pick<
    INetwork,
    | "getConnectedPeers"
    | "getConnectedPeerSyncMeta"
    | "reportPeer"
    | "sendBeaconBlocksByRange"
    | "sendBeaconBlocksByRoot"
    | "sendDataColumnSidecarsByRange"
    | "sendExecutionPayloadEnvelopesByRange"
  >;
  logger: Logger;
  metrics: Metrics | null;
  /** Backfill only runs while the node follows the head */
  isSynced: () => boolean;
  /** Builder at `builderIndex` in the head state, null if there is none */
  getBuilder: (builderIndex: BuilderIndex) => gloas.Builder | null;
};

/**
 * Position of the next block to backfill, derived from the earliest stored block at or above
 * `earliestAvailableSlot`. Nothing else is persisted: the block archive and the floor are the progress marker.
 */
type BackfillCursor = {
  /** `earliestAvailableSlot` this cursor was derived for */
  floor: Slot;
  /** Slot of the earliest stored block, the next block is strictly below it */
  childSlot: Slot;
  /** Root of the next block */
  parentRoot: Root;
  /** Gloas: the earliest stored block builds on the payload of the next block only if their hashes match */
  parentBlockHash: Uint8Array | null;
};

type BackfillBatch = {
  /** Ascending, never empty */
  blocks: BackfillBlock[];
  columns: Map<RootHex, Map<ColumnIndex, DataColumnSidecar>>;
  envelopes: Map<Slot, gloas.SignedExecutionPayloadEnvelope>;
};

/**
 * Downloads the history a checkpoint synced node is missing, from `earliestAvailableSlot` down to the start of
 * the range the spec requires to serve: `current_epoch - MIN_EPOCHS_FOR_BLOCK_REQUESTS`.
 *
 * History is extended strictly downwards, one batch at a time, so the stored chain never has holes:
 * 1. Request the slots below the earliest stored block from a peer advertising that range.
 * 2. Verify the blocks link to the parent root of the earliest stored block and are signed by their proposer.
 * 3. Download and verify what the node has to serve along the blocks: custody columns inside the sidecar
 *    retention window and, from Gloas, the envelopes of canonical payloads.
 * 4. Write everything, then lower `earliestAvailableSlot`.
 *
 * A crash before the floor is lowered leaves verified data below it, which the next run downloads again.
 */
export class BackfillSync {
  private readonly config: BeaconConfig;
  private readonly chain: BackfillSyncModules["chain"];
  private readonly db: BackfillSyncModules["db"];
  private readonly network: BackfillSyncModules["network"];
  private readonly logger: Logger;
  private readonly metrics: Metrics | null;
  private readonly isSynced: () => boolean;
  private readonly getBuilder: BackfillSyncModules["getBuilder"];

  private readonly controller = new AbortController();
  private readonly peerCooldowns = new Map<PeerIdStr, number>();
  private cursor: BackfillCursor | null = null;
  private status = BackfillSyncStatus.Waiting;
  /** Lowest custody group count any batch of this run was backfilled with */
  private backfilledCustodyGroupCount: number;

  constructor(modules: BackfillSyncModules) {
    this.config = modules.config;
    this.chain = modules.chain;
    this.db = modules.db;
    this.network = modules.network;
    this.logger = modules.logger;
    this.metrics = modules.metrics;
    this.isSynced = modules.isSynced;
    this.getBuilder = modules.getBuilder;
    this.backfilledCustodyGroupCount = this.chain.custodyConfig.targetCustodyGroupCount;
  }

  start(): void {
    void this.run();
  }

  close(): void {
    this.controller.abort();
  }

  /**
   * Attempt to backfill one batch. Returns true if `earliestAvailableSlot` was lowered.
   */
  async backfillBatch(): Promise<boolean> {
    const floor = this.chain.earliestAvailableSlot;
    const targetSlot = this.getTargetSlot();
    this.metrics?.backfillSync.earliestAvailableSlot.set(floor);
    this.metrics?.backfillSync.targetSlot.set(targetSlot);

    if (floor <= targetSlot) {
      if (this.status === BackfillSyncStatus.Syncing) {
        this.logger.info("Backfill sync completed", {earliestAvailableSlot: floor, targetSlot});
      }
      this.setStatus(BackfillSyncStatus.Completed);
      return false;
    }

    // Nothing archived above the floor until the first finalization after a checkpoint sync
    const cursor = this.isSynced() ? await this.getCursor(floor) : null;
    if (cursor === null) {
      this.setStatus(BackfillSyncStatus.Waiting);
      return false;
    }

    const endSlot = cursor.childSlot;
    const startSlot = Math.max(endSlot - SLOTS_PER_EPOCH, targetSlot);

    if (this.status !== BackfillSyncStatus.Syncing) {
      this.logger.info("Backfill sync started", {earliestAvailableSlot: floor, targetSlot});
    }
    this.setStatus(BackfillSyncStatus.Syncing);

    const peers = this.getPeers(startSlot);
    this.metrics?.backfillSync.peers.set(peers.length);
    const peer = peers[0];
    if (peer === undefined) {
      this.logger.debug("No peers to backfill from", {startSlot, endSlot});
      return false;
    }

    let batch: BackfillBatch;
    try {
      const blocks = await this.timeStep(BackfillBatchStep.blocks, () =>
        this.downloadBlocks(peer.peerId, cursor, startSlot, endSlot)
      );
      const fullPayloads = getFullPayloads(blocks, cursor.parentBlockHash);
      const envelopes = await this.timeStep(BackfillBatchStep.envelopes, () =>
        this.downloadEnvelopes(peer.peerId, blocks, fullPayloads)
      );
      const columns = await this.timeStep(BackfillBatchStep.columns, () =>
        this.downloadColumns(peers, blocks, fullPayloads)
      );
      batch = {blocks, columns, envelopes};
    } catch (e) {
      this.onDownloadError(peer.peerId, e as Error, {startSlot, count: endSlot - startSlot});
      return false;
    }

    await this.timeStep(BackfillBatchStep.persist, () => this.persistBatch(floor, batch));
    this.logger.verbose("Backfilled batch", {
      startSlot: batch.blocks[0].block.message.slot,
      endSlot,
      blocks: batch.blocks.length,
      earliestAvailableSlot: this.chain.earliestAvailableSlot,
      targetSlot,
    });
    return true;
  }

  private async run(): Promise<void> {
    const {signal} = this.controller;
    while (!signal.aborted) {
      let progressed = false;
      try {
        progressed = await this.backfillBatch();
      } catch (e) {
        if (signal.aborted) return;
        this.metrics?.backfillSync.batchErrors.inc({code: (e as BackfillSyncError).type?.code ?? "unknown"});
        this.logger.debug("Error on backfill batch", {}, e as Error);
      }
      await sleep(progressed ? BATCH_INTERVAL_MS : this.config.SLOT_DURATION_MS, signal).catch(() => {});
    }
  }

  private setStatus(status: BackfillSyncStatus): void {
    this.status = status;
    this.metrics?.backfillSync.status.set(backfillSyncStatusMetric[status]);
    // Custody columns are part of every batch, so they are backfilled once the blocks are
    this.metrics?.peerDas.custodyGroupsBackfilled.set(
      status === BackfillSyncStatus.Completed ? this.backfilledCustodyGroupCount : 0
    );
  }

  private async timeStep<T>(step: BackfillBatchStep, fn: () => Promise<T>): Promise<T> {
    const timer = this.metrics?.backfillSync.batchStepDuration.startTimer({step});
    try {
      return await fn();
    } finally {
      timer?.();
    }
  }

  /** Same range as `pruneHistory` keeps, backfilling below it would only be pruned again */
  private getTargetSlot(): Slot {
    return computeStartSlotAtEpoch(
      Math.max(this.chain.clock.currentEpoch - this.config.MIN_EPOCHS_FOR_BLOCK_REQUESTS, GENESIS_EPOCH)
    );
  }

  private async getCursor(floor: Slot): Promise<BackfillCursor | null> {
    if (this.cursor?.floor === floor) {
      return this.cursor;
    }

    const [child] = await this.db.blockArchive.values({gte: floor, limit: 1});
    if (child === undefined) {
      return null;
    }

    this.cursor = toCursor(floor, child);
    return this.cursor;
  }

  /**
   * Connected peers able to serve from `startSlot`, in the order they should be tried: most custody columns
   * in common first so a batch needs as few peers as possible.
   */
  private getPeers(startSlot: Slot): PeerSyncMeta[] {
    const now = Date.now();
    const isPostFulu = isForkPostFulu(this.config.getForkName(this.chain.clock.currentSlot));
    const custodyColumns = new Set(this.chain.custodyConfig.custodyColumns);
    const peers: {meta: PeerSyncMeta; commonColumns: number}[] = [];

    for (const peerId of shuffle(this.network.getConnectedPeers())) {
      const cooldownUntil = this.peerCooldowns.get(peerId);
      if (cooldownUntil !== undefined) {
        if (cooldownUntil > now) continue;
        this.peerCooldowns.delete(peerId);
      }

      const meta = this.network.getConnectedPeerSyncMeta(peerId);
      // Status only carries earliestAvailableSlot from Fulu, before that any peer may have the range
      if (meta.earliestAvailableSlot === undefined ? isPostFulu : meta.earliestAvailableSlot > startSlot) {
        continue;
      }
      peers.push({meta, commonColumns: meta.custodyColumns.filter((index) => custodyColumns.has(index)).length});
    }

    return peers.sort((a, b) => b.commonColumns - a.commonColumns).map(({meta}) => meta);
  }

  private async downloadBlocks(
    peerId: PeerIdStr,
    cursor: BackfillCursor,
    startSlot: Slot,
    endSlot: Slot
  ): Promise<BackfillBlock[]> {
    const count = endSlot - startSlot;
    let minSlot = startSlot;
    let blocks = await this.network.sendBeaconBlocksByRange(peerId, {startSlot, count, step: 1});

    if (blocks.length === 0) {
      this.metrics?.backfillSync.blocksByRootRequests.inc();
      // Either every slot of the range was skipped or the peer withholds blocks. The parent root tells them apart
      // as a block returned for it is known to be the next one, wherever its slot is.
      minSlot = GENESIS_SLOT;
      blocks = await this.network.sendBeaconBlocksByRoot(peerId, [cursor.parentRoot]);
      if (blocks.length === 0) {
        throw new BackfillSyncError({
          code: BackfillSyncErrorCode.BLOCK_UNAVAILABLE,
          root: toRootHex(cursor.parentRoot),
          startSlot,
          count,
        });
      }
    }

    const verified = assertLinearChainToRoot(this.config, blocks, cursor.parentRoot, minSlot, endSlot);
    await verifyProposerSignatures(this.config, this.chain.bls, this.chain.pubkeyCache.size, verified);
    return verified;
  }

  /**
   * The proposer signature covers the bid, so an envelope consistent with it is the payload the chain built on
   * whoever signed it. Envelopes whose signature can't be verified are stored and served as received, a peer
   * with the historical state can still verify them.
   * See https://github.com/ethereum/consensus-specs/pull/5771
   */
  private async downloadEnvelopes(
    peerId: PeerIdStr,
    blocks: BackfillBlock[],
    fullPayloads: Set<Slot>
  ): Promise<Map<Slot, gloas.SignedExecutionPayloadEnvelope>> {
    const envelopes = new Map<Slot, gloas.SignedExecutionPayloadEnvelope>();
    const fullBlocks = blocks.filter(({block}) => fullPayloads.has(block.message.slot));
    if (fullBlocks.length === 0) {
      return envelopes;
    }

    const response = await this.network.sendExecutionPayloadEnvelopesByRange(peerId, getSlotRange(fullBlocks));
    const validated = validateEnvelopesByRangeResponse(blocks, undefined, response);

    const signatureSets: ISignatureSet[] = [];
    for (const {block, blockRoot} of fullBlocks) {
      const slot = block.message.slot;
      const envelope = validated.get(slot);
      if (envelope === undefined) {
        throw new BackfillSyncError({
          code: BackfillSyncErrorCode.ENVELOPE_UNAVAILABLE,
          slot,
          root: toRootHex(blockRoot),
        });
      }

      const message = block.message as gloas.BeaconBlock;
      assertEnvelopeConsistency(envelope.message, message, blockRoot);
      const signatureSet = getBackfillEnvelopeSignatureSet(this.config, envelope, message, this.getBuilder);
      if (signatureSet !== null) signatureSets.push(signatureSet);
      envelopes.set(slot, envelope);
    }

    if (signatureSets.length > 0 && !(await this.chain.bls.verifySignatureSets(signatureSets, {batchable: true}))) {
      throw new BackfillSyncError({
        code: BackfillSyncErrorCode.INVALID_ENVELOPE_SIGNATURE,
        ...getSlotRange(fullBlocks),
      });
    }
    this.metrics?.backfillSync.envelopeSignatures.inc({verified: "true"}, signatureSets.length);
    this.metrics?.backfillSync.envelopeSignatures.inc({verified: "false"}, envelopes.size - signatureSets.length);
    return envelopes;
  }

  private async downloadColumns(
    peers: PeerSyncMeta[],
    blocks: BackfillBlock[],
    fullPayloads: Set<Slot>
  ): Promise<Map<RootHex, Map<ColumnIndex, DataColumnSidecar>>> {
    const columns = new Map<RootHex, Map<ColumnIndex, DataColumnSidecar>>();
    const {custodyColumns} = this.chain.custodyConfig;
    const columnsMinSlot = computeStartSlotAtEpoch(
      Math.max(getBlobDataRetentionStartEpoch(this.config, this.chain.clock.currentEpoch), this.config.FULU_FORK_EPOCH)
    );

    const blocksWithColumns = blocks.filter(({block}) => {
      const slot = block.message.slot;
      if (slot < columnsMinSlot) return false;
      // Columns of a Gloas payload that did not become canonical are pruned, peers can't serve them
      if (isGloasBeaconBlock(block.message) && !fullPayloads.has(slot)) return false;
      const commitments = getBlobKzgCommitments(
        this.config.getForkName(slot),
        block as SignedBeaconBlock<ForkPostFulu>
      );
      return commitments.length > 0;
    });
    if (blocksWithColumns.length === 0 || custodyColumns.length === 0) {
      return columns;
    }
    const blocksByRoot = new Map<RootHex, SignedBeaconBlock>();
    for (const {block, blockRoot} of blocksWithColumns) {
      const blockRootHex = toRootHex(blockRoot);
      columns.set(blockRootHex, new Map());
      blocksByRoot.set(blockRootHex, block);
    }

    const untriedPeers = [...peers];
    let pendingBlocks = blocksWithColumns;
    let missingColumns = custodyColumns;

    for (let i = 0; i < MAX_COLUMN_REQUESTS_PER_BATCH; i++) {
      const peerIndex = untriedPeers.findIndex((peer) =>
        peer.custodyColumns.some((index) => missingColumns.includes(index))
      );
      if (peerIndex === -1) break;
      const [peer] = untriedPeers.splice(peerIndex, 1);

      const request = {
        ...getSlotRange(pendingBlocks),
        columns: missingColumns.filter((index) => peer.custodyColumns.includes(index)),
      };

      try {
        const sidecars = await this.network.sendDataColumnSidecarsByRange(peer.peerId, request);
        const {result} = await validateColumnsByRangeResponse(
          this.config,
          request,
          pendingBlocks,
          sidecars,
          this.metrics?.peerDas
        );
        for (const {blockRoot, columnSidecars} of result) {
          const blockRootHex = toRootHex(blockRoot);
          const blockColumns = columns.get(blockRootHex);
          const block = blocksByRoot.get(blockRootHex);
          if (blockColumns === undefined || block === undefined) continue;
          for (const sidecar of columnSidecars) {
            if (!request.columns.includes(sidecar.index)) continue;
            assertSidecarHeaderSignature(block, sidecar);
            blockColumns.set(sidecar.index, sidecar);
          }
        }
      } catch (e) {
        this.onDownloadError(peer.peerId, e as Error, request);
      }

      pendingBlocks = blocksWithColumns.filter(
        ({blockRoot}) => columns.get(toRootHex(blockRoot))?.size !== custodyColumns.length
      );
      if (pendingBlocks.length === 0) {
        return columns;
      }
      missingColumns = custodyColumns.filter((index) =>
        pendingBlocks.some(({blockRoot}) => !columns.get(toRootHex(blockRoot))?.has(index))
      );
    }

    throw new BackfillSyncError({
      code: BackfillSyncErrorCode.COLUMNS_UNAVAILABLE,
      ...getSlotRange(pendingBlocks),
      missingColumns: prettyPrintIndices(missingColumns),
    });
  }

  private async persistBatch(floor: Slot, {blocks, columns, envelopes}: BackfillBatch): Promise<void> {
    let columnCount = 0;
    for (const {block, blockRoot} of blocks) {
      const slot = block.message.slot;
      const blockRootHex = toRootHex(blockRoot);
      const blockColumns = columns.get(blockRootHex);
      if (blockColumns === undefined) continue;
      columnCount += blockColumns.size;
      const sidecarType = this.config.getForkTypes<ForkPostFulu>(slot).DataColumnSidecar;
      await this.db.dataColumns.putManyBinary(
        {slot, blockRoot: blockRootHex},
        Array.from(blockColumns.values(), (sidecar) => ({index: sidecar.index, data: sidecarType.serialize(sidecar)}))
      );
    }

    if (envelopes.size > 0) {
      await this.db.executionPayloadEnvelopeArchive.batchPutBinary(
        Array.from(envelopes, ([slot, envelope]) => ({
          key: slot,
          value: ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope),
        }))
      );
    }

    await this.db.blockArchive.batchPutBinary(
      blocks.map(({block, blockRoot}) => {
        const slot = block.message.slot;
        return {
          key: slot,
          value: this.config.getForkTypes(slot).SignedBeaconBlock.serialize(block),
          slot,
          blockRoot,
          parentRoot: block.message.parentRoot,
        };
      })
    );

    // `pruneHistory` raises the floor and deletes below it concurrently. It never prunes above the target, so
    // the floor must be validated and lowered in memory without yielding in between, and never below the target.
    const targetSlot = this.getTargetSlot();
    const earliestBlock = blocks[0].block;
    if (this.chain.earliestAvailableSlot !== floor || floor <= targetSlot) {
      throw new BackfillSyncError({
        code: BackfillSyncErrorCode.STALE_BATCH,
        startSlot: earliestBlock.message.slot,
        earliestAvailableSlot: this.chain.earliestAvailableSlot,
        targetSlot,
      });
    }
    const earliestAvailableSlot = Math.min(Math.max(earliestBlock.message.slot, targetSlot), floor);
    this.chain.earliestAvailableSlot = earliestAvailableSlot;
    this.cursor = toCursor(earliestAvailableSlot, earliestBlock);
    await this.db.earliestAvailableSlot.set(earliestAvailableSlot);

    this.backfilledCustodyGroupCount = Math.min(
      this.backfilledCustodyGroupCount,
      this.chain.custodyConfig.targetCustodyGroupCount
    );
    this.metrics?.backfillSync.batches.inc();
    this.metrics?.backfillSync.blocks.inc(blocks.length);
    this.metrics?.backfillSync.dataColumnSidecars.inc(columnCount);
    this.metrics?.backfillSync.executionPayloadEnvelopes.inc(envelopes.size);
  }

  private onDownloadError(peerId: PeerIdStr, e: Error, {startSlot, count}: {startSlot: Slot; count: number}): void {
    this.peerCooldowns.set(peerId, Date.now() + PEER_COOLDOWN_MS);

    const code = (e as BackfillSyncError | DownloadByRangeError).type?.code ?? "unknown";
    this.metrics?.backfillSync.batchErrors.inc({code});
    this.logger.debug("Error downloading backfill batch", {startSlot, count, peer: peerId}, e);

    // Not serving a range is not a fault, the peer may still be backfilling or have pruned it
    const isUnavailable =
      e instanceof BackfillSyncError &&
      (e.type.code === BackfillSyncErrorCode.BLOCK_UNAVAILABLE ||
        e.type.code === BackfillSyncErrorCode.ENVELOPE_UNAVAILABLE ||
        e.type.code === BackfillSyncErrorCode.COLUMNS_UNAVAILABLE);
    const isInvalid =
      e instanceof BackfillSyncError ||
      e instanceof DownloadByRangeError ||
      e instanceof DataColumnSidecarValidationError;
    if (isInvalid && !isUnavailable) {
      this.network.reportPeer(peerId, PeerAction.LowToleranceError, "BackfillSyncInvalidResponse");
    }
  }
}

function getSlotRange(blocks: BackfillBlock[]): {startSlot: Slot; count: number} {
  const slots = blocks.map(({block}) => block.message.slot);
  const startSlot = Math.min(...slots);
  return {startSlot, count: Math.max(...slots) - startSlot + 1};
}

function toCursor(floor: Slot, child: SignedBeaconBlock): BackfillCursor {
  return {
    floor,
    childSlot: child.message.slot,
    parentRoot: child.message.parentRoot,
    parentBlockHash: isGloasBeaconBlock(child.message)
      ? child.message.body.signedExecutionPayloadBid.message.parentBlockHash
      : null,
  };
}

/**
 * Slots of Gloas blocks whose payload is canonical: the child block builds on it. Only those have an envelope
 * and columns to serve.
 */
function getFullPayloads(blocks: BackfillBlock[], childParentBlockHash: Uint8Array | null): Set<Slot> {
  const fullPayloads = new Set<Slot>();
  let parentBlockHash = childParentBlockHash;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const {message} = blocks[i].block;
    if (!isGloasBeaconBlock(message)) break;

    const bid = message.body.signedExecutionPayloadBid.message;
    // The genesis block has no envelope
    if (message.slot !== GENESIS_SLOT && parentBlockHash !== null && byteArrayEquals(bid.blockHash, parentBlockHash)) {
      fullPayloads.add(message.slot);
    }
    parentBlockHash = bid.parentBlockHash;
  }
  return fullPayloads;
}

/**
 * Sidecars are served with their signed header, the block root does not cover its signature.
 * Gloas sidecars carry no header.
 */
function assertSidecarHeaderSignature(block: SignedBeaconBlock, sidecar: DataColumnSidecar): void {
  if (!isGloasDataColumnSidecar(sidecar) && !byteArrayEquals(sidecar.signedBlockHeader.signature, block.signature)) {
    throw new BackfillSyncError({
      code: BackfillSyncErrorCode.INVALID_SIDECAR_HEADER_SIGNATURE,
      slot: block.message.slot,
      columnIndex: sidecar.index,
    });
  }
}
