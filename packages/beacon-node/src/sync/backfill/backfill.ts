import {EventEmitter} from "events";
import {PeerId} from "@libp2p/interface-peer-id";
import {StrictEventEmitter} from "strict-event-emitter-types";
import {BeaconStateAllForks, blockToHeader} from "@lodestar/state-transition";
import {IBeaconConfig, IChainForkConfig} from "@lodestar/config";
import {phase0, Root, Slot, allForks, ssz} from "@lodestar/types";
import {ErrorAborted, ILogger, sleep} from "@lodestar/utils";
import {toHexString} from "@chainsafe/ssz";

import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {IBeaconChain} from "../../chain/index.js";
import {GENESIS_SLOT, ZERO_HASH} from "../../constants/index.js";
import {IBeaconDb} from "../../db/index.js";
import {INetwork, NetworkEvent, PeerAction} from "../../network/index.js";
import {ItTrigger} from "../../util/itTrigger.js";
import {PeerSet} from "../../util/peerMap.js";
import {shuffleOne} from "../../util/shuffle.js";
import {IMetrics} from "../../metrics/metrics";
import {byteArrayEquals} from "../../util/bytes.js";
import {computeAnchorCheckpoint} from "../../chain/initState.js";
import {verifyBlockProposerSignature, verifyBlockSequence, BackfillBlockHeader, BackfillBlock} from "./verify.js";
import {BackfillSyncError, BackfillSyncErrorCode} from "./errors.js";
/**
 * Timeout in ms to take a break from reading a backfillBatchSize from db, as just yielding
 * to sync loop gives hardly any.
 */
const DB_READ_BREATHER_TIMEOUT = 1000;

export type BackfillSyncModules = {
  chain: IBeaconChain;
  db: IBeaconDb;
  network: INetwork;
  config: IBeaconConfig;
  logger: ILogger;
  metrics: IMetrics | null;
  anchorState: BeaconStateAllForks;
  wsCheckpoint?: phase0.Checkpoint;
  signal: AbortSignal;
};

type BackfillModules = BackfillSyncModules & {
  syncAnchor: BackFillSyncAnchor;
  backfillStartFromSlot: Slot;
  prevFinalizedCheckpointBlock: BackfillBlockHeader;
  wsCheckpointHeader: BackfillBlockHeader | null;
  backfillRangeWrittenSlot: Slot | null;
};

export type BackfillSyncOpts = {
  backfillBatchSize: number;
};

export enum BackfillSyncEvent {
  completed = "BackfillSync-completed",
}

export enum BackfillSyncMethod {
  database = "database",
  backfilled_ranges = "backfilled_ranges",
  rangesync = "rangesync",
  blockbyroot = "blockbyroot",
}

export enum BackfillSyncStatus {
  pending = "pending",
  syncing = "syncing",
  completed = "completed",
  aborted = "aborted",
}

/** Map a SyncState to an integer for rendering in Grafana */
const syncStatus: {[K in BackfillSyncStatus]: number} = {
  [BackfillSyncStatus.aborted]: 0,
  [BackfillSyncStatus.pending]: 1,
  [BackfillSyncStatus.syncing]: 2,
  [BackfillSyncStatus.completed]: 3,
};

type BackfillSyncEvents = {
  [BackfillSyncEvent.completed]: (
    /** Oldest slot synced */
    oldestSlotSynced: Slot
  ) => void;
};

type BackfillSyncEmitter = StrictEventEmitter<EventEmitter, BackfillSyncEvents>;

/**
 * At any given point, we should have
 * 1. anchorBlock (with its root anchorBlockRoot at anchorSlot) for next round of sync
 *    which is the same as the lastBackSyncedBlock
 * 2. We know the anchorBlockRoot but don't have its anchorBlock and anchorSlot yet, and its
 *    parent of lastBackSyncedBlock we synced in a previous successfull round
 * 3. We just started with only anchorBlockRoot, but we know (and will validate) its anchorSlot
 */
type BackFillSyncAnchor =
  | {
      anchorBlock: allForks.SignedBeaconBlock;
      anchorBlockRoot: Root;
      anchorSlot: Slot;
      lastBackSyncedBlock: BackfillBlock;
    }
  | {anchorBlock: null; anchorBlockRoot: Root; anchorSlot: null; lastBackSyncedBlock: BackfillBlock}
  | {anchorBlock: null; anchorBlockRoot: Root; anchorSlot: Slot; lastBackSyncedBlock: null};

export class BackfillSync extends (EventEmitter as {new (): BackfillSyncEmitter}) {
  /** Lowest slot that we have backfilled to */
  syncAnchor: BackFillSyncAnchor;

  private readonly chain: IBeaconChain;
  private readonly network: INetwork;
  private readonly db: IBeaconDb;
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;
  private readonly metrics: IMetrics | null;

  /**
   * Process in blocks of at max batchSize
   */
  private opts: BackfillSyncOpts;
  /**
   * If wsCheckpoint provided was in past then the (db) state from which beacon node started,
   * needs to be validated as per spec.
   *
   * 1. This could lie in between of the previous backfilled range, in which case it would be
   *    sufficient to check if its DB, once the linkage to that range has been verified.
   * 2. Else if it lies outside the backfilled range, the linkage to this checkpoint in
   *    backfill needs to be verified.
   */
  private wsCheckpointHeader: BackfillBlockHeader | null;
  private wsValidated = false;

  /**
   * From https://github.com/ethereum/consensus-specs/blob/dev/specs/phase0/weak-subjectivity.md
   *
   *
   * If
   *   1. The wsCheckpoint provided was ahead of the db's finalized checkpoint or
   *   2. There were gaps in the backfill - keys to backfillRanges are always (by construction)
   *     a) Finalized Checkpoint or b) previous wsCheckpoint
   *
   * the linkage to the previous finalized/wss checkpoint(s) needs to be verfied. If there is
   * no such checkpoint remaining, the linkage to genesis needs to be validated
   *
   * Initialize with the blockArchive's last block, and on verification update to the next
   * preceding backfillRange key's checkpoint.
   */
  private prevFinalizedCheckpointBlock: BackfillBlockHeader;
  /** Starting point that this specific backfill sync "session" started from */
  private backfillStartFromSlot: Slot;
  private backfillRangeWrittenSlot: Slot | null;

  private processor = new ItTrigger();
  private peers = new PeerSet();
  private status: BackfillSyncStatus = BackfillSyncStatus.pending;
  private signal: AbortSignal;

  constructor(opts: BackfillSyncOpts, modules: BackfillModules) {
    super();

    this.syncAnchor = modules.syncAnchor;
    this.backfillStartFromSlot = modules.backfillStartFromSlot;
    this.backfillRangeWrittenSlot = modules.backfillRangeWrittenSlot;
    this.prevFinalizedCheckpointBlock = modules.prevFinalizedCheckpointBlock;
    this.wsCheckpointHeader = modules.wsCheckpointHeader;

    this.chain = modules.chain;
    this.network = modules.network;
    this.db = modules.db;
    this.config = modules.config;
    this.logger = modules.logger;
    this.metrics = modules.metrics;

    this.opts = opts;
    this.network.events.on(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.on(NetworkEvent.peerDisconnected, this.removePeer);
    this.signal = modules.signal;

    this.sync()
      .then((oldestSlotSynced) => {
        if (this.status !== BackfillSyncStatus.completed) {
          throw new ErrorAborted(`Invalid BackfillSyncStatus at the completion of sync loop status=${this.status}`);
        }
        this.emit(BackfillSyncEvent.completed, oldestSlotSynced);
        this.logger.info("BackfillSync completed", {oldestSlotSynced});
        // Sync completed, unsubscribe listeners and don't run the processor again.
        // Backfill is never necessary again until the node shuts down
        this.close();
      })
      .catch((e) => {
        this.logger.error("BackfillSync processor error", e);
        this.status = BackfillSyncStatus.aborted;
        this.close();
      });

    const metrics = this.metrics;
    if (metrics) {
      metrics.backfillSync.status.addCollect(() => metrics.backfillSync.status.set(syncStatus[this.status]));
      metrics.backfillSync.backfilledTillSlot.addCollect(() =>
        metrics.backfillSync.backfilledTillSlot.set(
          this.syncAnchor.lastBackSyncedBlock?.slot ?? this.backfillStartFromSlot
        )
      );
      metrics.backfillSync.prevFinOrWsSlot.addCollect(() =>
        metrics.backfillSync.prevFinOrWsSlot.set(Math.max(this.prevFinalizedCheckpointBlock.slot, GENESIS_SLOT))
      );
    }
  }

  /**
   * Use the root of the anchorState of the beacon node as the starting point of the
   * backfill sync with its expected slot to be anchorState.slot, which will be
   * validated once the block is resolved in the backfill sync.
   *
   * NOTE: init here is quite light involving couple of
   *
   *   1. db keys lookup in stateArchive/backfilledRanges
   *   2. computing root(s) for anchorBlockRoot and prevFinalizedCheckpointBlock
   *
   * The way we initialize beacon node, wsCheckpoint's slot is always <= anchorSlot
   * If:
   *   the root belonging to wsCheckpoint is in the DB, we need to verify linkage to it
   *   i.e. it becomes our first prevFinalizedCheckpointBlock
   * Else
   *   we initialize prevFinalizedCheckpointBlock from the last stored db finalized state
   *   for verification and when we go below its epoch we just check if a correct block
   *   corresponding to wsCheckpoint root was stored.
   *
   * and then we continue going back and verifying the next unconnected previous finalized
   * or wsCheckpoints identifiable as the keys of backfill sync.
   */
  static async init<T extends BackfillSync = BackfillSync>(
    opts: BackfillSyncOpts,
    modules: BackfillSyncModules
  ): Promise<T> {
    const {config, anchorState, db, wsCheckpoint, logger} = modules;

    const {checkpoint: anchorCp} = computeAnchorCheckpoint(config, anchorState);
    const anchorSlot = anchorState.latestBlockHeader.slot;
    const syncAnchor = {
      anchorBlock: null,
      anchorBlockRoot: anchorCp.root,
      anchorSlot,
      lastBackSyncedBlock: null,
    };

    // Load the previous written to slot for the key  backfillStartFromSlot
    // in backfilledRanges
    const backfillStartFromSlot = anchorSlot;
    const backfillRangeWrittenSlot = await db.backfilledRanges.get(backfillStartFromSlot);
    const previousBackfilledRanges = await db.backfilledRanges.entries({
      lte: backfillStartFromSlot,
    });
    modules.logger.info("Initializing from Checkpoint", {
      root: toHexString(anchorCp.root),
      epoch: anchorCp.epoch,
      backfillStartFromSlot,
      previousBackfilledRanges: JSON.stringify(previousBackfilledRanges),
    });

    // wsCheckpointHeader is where the checkpoint can actually be validated
    const wsCheckpointHeader: BackfillBlockHeader | null = wsCheckpoint
      ? {root: wsCheckpoint.root, slot: wsCheckpoint.epoch * SLOTS_PER_EPOCH}
      : null;
    // Load a previous finalized or wsCheckpoint slot from DB below anchorSlot
    const prevFinalizedCheckpointBlock = await extractPreviousFinOrWsCheckpoint(config, db, anchorSlot, logger);

    return new this(opts, {
      syncAnchor,
      backfillStartFromSlot,
      backfillRangeWrittenSlot,
      wsCheckpointHeader,
      prevFinalizedCheckpointBlock,
      ...modules,
    }) as T;
  }

  /** Throw / return all AsyncGenerators */
  close(): void {
    this.network.events.off(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.off(NetworkEvent.peerDisconnected, this.removePeer);
    this.processor.end(new ErrorAborted("BackfillSync"));
  }

  /**
   * @returns Returns oldestSlotSynced
   */
  private async sync(): Promise<Slot> {
    this.processor.trigger();

    for await (const _ of this.processor) {
      if (this.status === BackfillSyncStatus.aborted) {
        /** Break out of sync loop and throw error */
        break;
      }
      this.status = BackfillSyncStatus.syncing;

      // 1. We should always have either anchorBlock or anchorBlockRoot, they are the
      //    anchor points for this round of the sync
      // 2. Check and validate if we have reached prevFinalizedCheckpointBlock
      //    On success Update prevFinalizedCheckpointBlock to check the *next* previous
      // 3. Validate Checkpoint as part of DB block tree if we have backfilled
      //    before the checkpoint
      // 4. Exit the sync if backfilled till genesis
      //
      // 5. Check if we can jump back from available backfill sequence, if found yield and
      //    recontinue from top making checks
      // 7. Check and read batchSize from DB, if found yield and recontinue from top
      // 8. If not in DB, and if peer available
      //    a) Either fetch blockByRoot if only anchorBlockRoot is set, which could be because
      //       i) its the unavailable root of the very first block to start off sync
      //       ii) its parent of lastBackSyncedBlock and there was an issue in establishing
      //           linear sequence in syncRange as there could be one or more
      //           skipped/orphaned slots
      //           between the parent we want to fetch and lastBackSyncedBlock
      //    b) read previous batchSize blocks from network assuming most likely those blocks
      //       form a linear anchored chain with anchorBlock. If not, try fetching the
      //       parent of
      //       the anchorBlock via strategy a) as it could be multiple skipped/orphaned slots
      //       behind
      if (this.syncAnchor.lastBackSyncedBlock != null) {
        // If after a previous sync round:
        //   lastBackSyncedBlock.slot < prevFinalizedCheckpointBlock.slot
        // then it means the prevFinalizedCheckpoint block has been missed because in each
        // round we backfill new blocks till (if the batchSize allows):
        // lastBackSyncedBlock.slot <= prevFinalizedCheckpointBlock.slot
        if (this.syncAnchor.lastBackSyncedBlock.slot < this.prevFinalizedCheckpointBlock.slot) {
          this.logger.error(
            `Backfilled till ${
              this.syncAnchor.lastBackSyncedBlock.slot
            } but not found previous saved finalized or wsCheckpoint with root=${toHexString(
              this.prevFinalizedCheckpointBlock.root
            )}, slot=${this.prevFinalizedCheckpointBlock.slot}`
          );
          // Break sync loop and throw error
          break;
        }

        if (this.syncAnchor.lastBackSyncedBlock.slot === this.prevFinalizedCheckpointBlock.slot) {
          // Okay! we backfilled successfully till prevFinalizedCheckpointBlock
          if (!byteArrayEquals(this.syncAnchor.lastBackSyncedBlock.root, this.prevFinalizedCheckpointBlock.root)) {
            this.logger.error(
              `Invalid root synced at a previous finalized or wsCheckpoint, slot=${
                this.prevFinalizedCheckpointBlock.slot
              }: expected=${toHexString(this.prevFinalizedCheckpointBlock.root)}, actual=${toHexString(
                this.syncAnchor.lastBackSyncedBlock.root
              )}`
            );
            // Break sync loop and throw error
            break;
          }
          this.logger.verbose("Validated current prevFinalizedCheckpointBlock", {
            root: toHexString(this.prevFinalizedCheckpointBlock.root),
            slot: this.prevFinalizedCheckpointBlock.slot,
          });

          // 1. If this is not a genesis block save this block in DB as this wasn't saved
          //    earlier pending validation. Genesis block will be saved with extra validation
          //    before returning from the sync.
          //
          // 2. Load another previous saved finalized or wsCheckpoint which has not
          //    been validated yet. These are the keys of backfill ranges as each
          //    range denotes
          //    a validated connected segment having the slots of previous wsCheckpoint
          //    or finalized as keys
          if (this.syncAnchor.lastBackSyncedBlock.slot !== GENESIS_SLOT) {
            await this.db.blockArchive.put(
              this.syncAnchor.lastBackSyncedBlock.slot,
              this.syncAnchor.lastBackSyncedBlock.block
            );
          }
          this.prevFinalizedCheckpointBlock = await extractPreviousFinOrWsCheckpoint(
            this.config,
            this.db,
            this.syncAnchor.lastBackSyncedBlock.slot,
            this.logger
          );
        }

        if (this.syncAnchor.lastBackSyncedBlock.slot === GENESIS_SLOT) {
          if (!byteArrayEquals(this.syncAnchor.lastBackSyncedBlock.block.message.parentRoot, ZERO_HASH)) {
            Error(
              `Invalid Gensis Block with non zero parentRoot=${toHexString(
                this.syncAnchor.lastBackSyncedBlock.block.message.parentRoot
              )}`
            );
          }
          await this.db.blockArchive.put(GENESIS_SLOT, this.syncAnchor.lastBackSyncedBlock.block);
        }

        if (this.wsCheckpointHeader && !this.wsValidated) {
          await this.checkIfCheckpointSyncedAndValidate();
        }

        if (
          this.backfillRangeWrittenSlot === null ||
          this.syncAnchor.lastBackSyncedBlock.slot < this.backfillRangeWrittenSlot
        ) {
          this.backfillRangeWrittenSlot = this.syncAnchor.lastBackSyncedBlock.slot;
          await this.db.backfilledRanges.put(this.backfillStartFromSlot, this.backfillRangeWrittenSlot);
          this.logger.debug(
            `Updated the backfill range from=${this.backfillStartFromSlot} till=${this.backfillRangeWrittenSlot}`
          );
        }

        if (this.syncAnchor.lastBackSyncedBlock.slot === GENESIS_SLOT) {
          this.logger.verbose("Successfully synced to genesis.");
          this.status = BackfillSyncStatus.completed;
          return GENESIS_SLOT;
        }

        const foundValidSeq = await this.checkUpdateFromBackfillSequences();
        if (foundValidSeq) {
          // Go back to top and do checks till
          this.processor.trigger();
          continue;
        }
      }

      try {
        const foundBlocks = await this.fastBackfillDb();
        if (foundBlocks) {
          this.processor.trigger();
          continue;
        }
      } catch (e) {
        this.logger.error("Error while reading from DB", {}, e as Error);
        // Break sync loop and throw error
        break;
      }

      // Try the network if nothing found in DB
      const peer = shuffleOne(this.peers.values());
      if (!peer) {
        this.status = BackfillSyncStatus.pending;
        this.logger.debug("No peers yet");
        continue;
      }

      try {
        if (!this.syncAnchor.anchorBlock) {
          await this.syncBlockByRoot(peer, this.syncAnchor.anchorBlockRoot);

          // Go back and make the checks in case this block could be at or
          // behind prevFinalizedCheckpointBlock
        } else {
          await this.syncRange(peer);

          // Go back and make the checks in case the lastbackSyncedBlock could be at or
          // behind prevFinalizedCheckpointBlock
        }
      } catch (e) {
        this.metrics?.backfillSync.errors.inc();
        this.logger.error("Sync error", {}, e as Error);

        if (e instanceof BackfillSyncError) {
          switch (e.type.code) {
            case BackfillSyncErrorCode.INTERNAL_ERROR:
              // Break it out of the loop and throw error
              this.status = BackfillSyncStatus.aborted;
              break;
            case BackfillSyncErrorCode.NOT_ANCHORED:
            case BackfillSyncErrorCode.NOT_LINEAR:
              // Lets try to jump directly to the parent of this anchorBlock as previous
              // (segment) of blocks could be orphaned/missed
              if (this.syncAnchor.anchorBlock) {
                this.syncAnchor = {
                  anchorBlock: null,
                  anchorBlockRoot: this.syncAnchor.anchorBlock.message.parentRoot,
                  anchorSlot: null,
                  lastBackSyncedBlock: this.syncAnchor.lastBackSyncedBlock,
                };
              }

            // falls through
            case BackfillSyncErrorCode.INVALID_SIGNATURE:
              this.network.reportPeer(peer, PeerAction.LowToleranceError, "BadSyncBlocks");
          }
        }
      } finally {
        if (this.status !== BackfillSyncStatus.aborted) this.processor.trigger();
      }
    }

    throw new ErrorAborted("BackfillSync");
  }

  private addPeer = (peerId: PeerId, peerStatus: phase0.Status): void => {
    const requiredSlot = this.syncAnchor.lastBackSyncedBlock?.slot ?? this.backfillStartFromSlot;
    this.logger.debug("Add peer", {peerhead: peerStatus.headSlot, requiredSlot});
    if (peerStatus.headSlot >= requiredSlot) {
      this.peers.add(peerId);
      this.processor.trigger();
    }
  };

  private removePeer = (peerId: PeerId): void => {
    this.peers.delete(peerId);
  };

  /**
   * Ensure that any weak subjectivity checkpoint provided in past with respect
   * the initialization point is the same block tree as the DB once backfill
   */
  private async checkIfCheckpointSyncedAndValidate(): Promise<void> {
    if (this.syncAnchor.lastBackSyncedBlock == null) {
      throw Error("Invalid lastBackSyncedBlock for checkpoint validation");
    }
    if (this.wsCheckpointHeader == null) {
      throw Error("Invalid null checkpoint for validation");
    }
    if (this.wsValidated) return;

    if (this.wsCheckpointHeader.slot >= this.syncAnchor.lastBackSyncedBlock.slot) {
      // Checkpoint root should be in db now , in case there are string of orphaned/missed
      // slots before/leading up to checkpoint, the block just backsynced before the
      // wsCheckpointHeader.slot will have the checkpoint root
      const wsDbCheckpointBlock = await this.db.blockArchive.getByRoot(this.wsCheckpointHeader.root);
      if (
        !wsDbCheckpointBlock ||
        // The only validation we can do here is that wsDbCheckpointBlock is found at/before
        // wsCheckpoint's epoch as there could be orphaned/missed slots all the way
        // from wsDbCheckpointBlock's slot to the wsCheckpoint's epoch

        // TODO: one can verify the child of wsDbCheckpointBlock is at
        // slot > wsCheckpointHeader
        // Note: next epoch is at wsCheckpointHeader.slot + SLOTS_PER_EPOCH
        wsDbCheckpointBlock.message.slot >= this.wsCheckpointHeader.slot + SLOTS_PER_EPOCH
      )
        // TODO: explode and stop the entire node
        throw new Error(
          `InvalidWsCheckpoint root=${this.wsCheckpointHeader.root}, epoch=${
            this.wsCheckpointHeader.slot / SLOTS_PER_EPOCH
          }, ${
            wsDbCheckpointBlock
              ? "found at epoch=" + Math.floor(wsDbCheckpointBlock?.message.slot / SLOTS_PER_EPOCH)
              : "not found"
          }`
        );
      this.logger.info("wsCheckpoint validated!", {
        root: toHexString(this.wsCheckpointHeader.root),
        epoch: this.wsCheckpointHeader.slot / SLOTS_PER_EPOCH,
      });
      this.wsValidated = true;
    }
  }

  private async checkUpdateFromBackfillSequences(): Promise<boolean> {
    if (this.syncAnchor.lastBackSyncedBlock === null) {
      throw Error("Backfill ranges can only be used once we have a valid lastBackSyncedBlock as a pivot point");
    }

    let validSequence = false;
    if (this.syncAnchor.lastBackSyncedBlock.slot === null) return validSequence;
    const lastBackSyncedSlot = this.syncAnchor.lastBackSyncedBlock.slot;

    const filteredSeqs = await this.db.backfilledRanges.entries({
      gte: lastBackSyncedSlot,
    });

    if (filteredSeqs.length > 0) {
      const jumpBackTo = Math.min(...filteredSeqs.map(({value: justToSlot}) => justToSlot));

      if (jumpBackTo < lastBackSyncedSlot) {
        validSequence = true;
        const anchorBlock = await this.db.blockArchive.get(jumpBackTo);
        if (!anchorBlock) {
          validSequence = false;
          this.logger.warn(
            `Invalid backfill sequence: expected a block at ${jumpBackTo} in blockArchive, ignoring the sequence`
          );
        }
        if (anchorBlock && validSequence) {
          if (this.prevFinalizedCheckpointBlock.slot >= jumpBackTo) {
            this.logger.debug(
              `Found a sequence going back to ${jumpBackTo} before the previous finalized or wsCheckpoint`,
              {slot: this.prevFinalizedCheckpointBlock.slot}
            );

            // Everything saved in db between a backfilled range is a connected sequence
            // we only need to check if prevFinalizedCheckpointBlock is in db
            const prevBackfillCpBlock = await this.db.blockArchive.getByRoot(this.prevFinalizedCheckpointBlock.root);
            if (
              prevBackfillCpBlock != null &&
              this.prevFinalizedCheckpointBlock.slot === prevBackfillCpBlock.message.slot
            ) {
              this.logger.verbose("Validated current prevFinalizedCheckpointBlock", {
                root: toHexString(this.prevFinalizedCheckpointBlock.root),
                slot: prevBackfillCpBlock.message.slot,
              });
            } else {
              validSequence = false;
              this.logger.warn(
                `Invalid backfill sequence: previous finalized or checkpoint block root=${
                  this.prevFinalizedCheckpointBlock.root
                }, slot=${this.prevFinalizedCheckpointBlock.slot} ${
                  prevBackfillCpBlock ? "found at slot=" + prevBackfillCpBlock.message.slot : "not found"
                }, ignoring the sequence`
              );
            }
          }
        }

        if (anchorBlock && validSequence) {
          // Update the current sequence in DB as we will be cleaning up previous sequences
          await this.db.backfilledRanges.put(this.backfillStartFromSlot, jumpBackTo);
          this.backfillRangeWrittenSlot = jumpBackTo;
          this.logger.verbose(
            `Jumped and updated the backfilled range ${this.backfillStartFromSlot}, ${this.backfillRangeWrittenSlot}`,
            {jumpBackTo}
          );

          const anchorBlockHeader = blockToHeader(this.config, anchorBlock.message);
          const anchorBlockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(anchorBlockHeader);

          this.syncAnchor = {
            anchorBlock,
            anchorBlockRoot,
            anchorSlot: jumpBackTo,
            lastBackSyncedBlock: {root: anchorBlockRoot, slot: jumpBackTo, block: anchorBlock},
          };
          if (this.prevFinalizedCheckpointBlock.slot >= jumpBackTo) {
            // prevFinalizedCheckpointBlock must have been validated, update to a
            // new unverified
            // finalized or wsCheckpoint behind the new lastBackSyncedBlock
            this.prevFinalizedCheckpointBlock = await extractPreviousFinOrWsCheckpoint(
              this.config,
              this.db,
              jumpBackTo,
              this.logger
            );
          }

          this.metrics?.backfillSync.totalBlocks.inc(
            {method: BackfillSyncMethod.backfilled_ranges},
            lastBackSyncedSlot - jumpBackTo
          );
        }
      }
    }

    // Only delete < backfillStartFromSlot, the keys greater than this would be cleaned
    // up by the archival process of forward sync
    const cleanupSeqs = filteredSeqs.filter((entry) => entry.key < this.backfillStartFromSlot);
    if (cleanupSeqs.length > 0) {
      await this.db.backfilledRanges.batchDelete(cleanupSeqs.map((entry) => entry.key));
      this.logger.debug(
        `Cleaned up the old sequences between ${this.backfillStartFromSlot},${this.syncAnchor.lastBackSyncedBlock}`,
        {cleanupSeqs: JSON.stringify(cleanupSeqs)}
      );
    }

    return validSequence;
  }

  private async fastBackfillDb(): Promise<boolean> {
    // Block of this anchorBlockRoot can't be behind the prevFinalizedCheckpointBlock
    // as prevFinalizedCheckpointBlock can't be skipped
    let anchorBlockRoot: Root;
    let expectedSlot: Slot | null = null;
    if (this.syncAnchor.anchorBlock) {
      anchorBlockRoot = this.syncAnchor.anchorBlock.message.parentRoot;
    } else {
      anchorBlockRoot = this.syncAnchor.anchorBlockRoot;
      expectedSlot = this.syncAnchor.anchorSlot;
    }
    let anchorBlock = await this.db.blockArchive.getByRoot(anchorBlockRoot);
    if (!anchorBlock) return false;

    if (expectedSlot !== null && anchorBlock.message.slot !== expectedSlot)
      throw Error(
        `Invalid slot of anchorBlock read from DB with root=${anchorBlockRoot}, expected=${expectedSlot}, actual=${anchorBlock.message.slot}`
      );

    // If possible, read back till anchorBlock > this.prevFinalizedCheckpointBlock
    let parentBlock,
      backCount = 1;

    let isPrevFinWsConfirmedAnchorParent = false;
    while (
      backCount !== this.opts.backfillBatchSize &&
      (parentBlock = await this.db.blockArchive.getByRoot(anchorBlock.message.parentRoot))
    ) {
      // Before moving anchorBlock back, we need check for prevFinalizedCheckpointBlock
      if (anchorBlock.message.slot < this.prevFinalizedCheckpointBlock.slot) {
        throw Error(
          `Skipped a prevFinalizedCheckpointBlock with slot=${this.prevFinalizedCheckpointBlock}, root=${toHexString(
            this.prevFinalizedCheckpointBlock.root
          )}`
        );
      }
      if (anchorBlock.message.slot === this.prevFinalizedCheckpointBlock.slot) {
        if (
          !isPrevFinWsConfirmedAnchorParent &&
          !byteArrayEquals(anchorBlockRoot, this.prevFinalizedCheckpointBlock.root)
        ) {
          throw Error(
            `Invalid root for prevFinalizedCheckpointBlock at slot=${
              this.prevFinalizedCheckpointBlock.slot
            }, expected=${toHexString(this.prevFinalizedCheckpointBlock.root)}, found=${anchorBlockRoot}`
          );
        }

        // If the new parentBlock is just one slot back, we can safely assign
        // prevFinalizedCheckpointBlock with the parentBlock and skip root
        // validation in next iteration. Else we need to extract
        // prevFinalizedCheckpointBlock
        if (parentBlock.message.slot === anchorBlock.message.slot - 1) {
          this.prevFinalizedCheckpointBlock = {root: anchorBlock.message.parentRoot, slot: parentBlock.message.slot};
          isPrevFinWsConfirmedAnchorParent = true;
        } else {
          // Extract new prevFinalizedCheckpointBlock below anchorBlock
          this.prevFinalizedCheckpointBlock = await extractPreviousFinOrWsCheckpoint(
            this.config,
            this.db,
            anchorBlock.message.slot,
            this.logger
          );
          isPrevFinWsConfirmedAnchorParent = false;
        }
      }
      anchorBlockRoot = anchorBlock.message.parentRoot;
      anchorBlock = parentBlock;
      backCount++;
    }

    this.syncAnchor = {
      anchorBlock,
      anchorBlockRoot,
      anchorSlot: anchorBlock.message.slot,
      lastBackSyncedBlock: {root: anchorBlockRoot, slot: anchorBlock.message.slot, block: anchorBlock},
    };
    this.metrics?.backfillSync.totalBlocks.inc({method: BackfillSyncMethod.database}, backCount);
    this.logger.verbose(`Read ${backCount} blocks from DB till `, {
      slot: anchorBlock.message.slot,
    });
    if (backCount >= this.opts.backfillBatchSize) {
      // We should sleep as there seems to be more that can be read from db but yielding to
      // the sync loop hardly gives any breather to the beacon node
      await sleep(DB_READ_BREATHER_TIMEOUT, this.signal);
    }
    return true;
  }

  private async syncBlockByRoot(peer: PeerId, anchorBlockRoot: Root): Promise<void> {
    const [anchorBlock] = await this.network.reqResp.beaconBlocksByRoot(peer, [anchorBlockRoot]);
    if (anchorBlock == null) throw new Error("InvalidBlockSyncedFromPeer");

    // GENESIS_SLOT doesn't has valid signature
    if (anchorBlock.message.slot === GENESIS_SLOT) return;
    await verifyBlockProposerSignature(this.chain.bls, this.chain.getHeadState(), [anchorBlock]);

    // We can write to the disk if this is ahead of prevFinalizedCheckpointBlock otherwise
    // we will need to go make checks on the top of sync loop before writing as it might
    // override prevFinalizedCheckpointBlock
    if (this.prevFinalizedCheckpointBlock.slot < anchorBlock.message.slot)
      await this.db.blockArchive.put(anchorBlock.message.slot, anchorBlock);

    this.syncAnchor = {
      anchorBlock,
      anchorBlockRoot,
      anchorSlot: anchorBlock.message.slot,
      lastBackSyncedBlock: {root: anchorBlockRoot, slot: anchorBlock.message.slot, block: anchorBlock},
    };

    this.metrics?.backfillSync.totalBlocks.inc({method: BackfillSyncMethod.blockbyroot});

    this.logger.verbose("Fetched new anchorBlock", {
      root: toHexString(anchorBlockRoot),
      slot: anchorBlock.message.slot,
    });

    return;
  }

  private async syncRange(peer: PeerId): Promise<void> {
    if (!this.syncAnchor.anchorBlock) {
      throw Error("Invalid anchorBlock null for syncRange");
    }

    const toSlot = this.syncAnchor.anchorBlock.message.slot;
    const fromSlot = Math.max(
      toSlot - this.opts.backfillBatchSize,
      this.prevFinalizedCheckpointBlock.slot,
      GENESIS_SLOT
    );
    const blocks = await this.network.reqResp.beaconBlocksByRange(peer, {
      startSlot: fromSlot,
      count: toSlot - fromSlot,
      step: 1,
    });

    const anchorParentRoot = this.syncAnchor.anchorBlock.message.parentRoot;

    if (blocks.length === 0) {
      // Lets just directly try to jump to anchorParentRoot
      this.syncAnchor = {
        anchorBlock: null,
        anchorBlockRoot: anchorParentRoot,
        anchorSlot: null,
        lastBackSyncedBlock: this.syncAnchor.lastBackSyncedBlock,
      };
      return;
    }

    const {nextAnchor, verifiedBlocks, error} = verifyBlockSequence(this.config, blocks, anchorParentRoot);

    // If any of the block's proposer signature fail, we can't trust this peer at all
    if (verifiedBlocks.length > 0) {
      await verifyBlockProposerSignature(this.chain.bls, this.chain.getHeadState(), verifiedBlocks);

      // This is bad, like super bad. Abort the backfill
      if (!nextAnchor)
        throw new BackfillSyncError({
          code: BackfillSyncErrorCode.INTERNAL_ERROR,
          reason: "Invalid verifyBlockSequence result",
        });

      // Verified blocks are in reverse order with the nextAnchor being the smallest slot
      // if nextAnchor is on the same slot as prevFinalizedCheckpointBlock, we can't save
      // it before returning to top of sync loop for validation
      await this.db.blockArchive.batchAdd(
        nextAnchor.slot > this.prevFinalizedCheckpointBlock.slot
          ? verifiedBlocks
          : verifiedBlocks.slice(0, verifiedBlocks.length - 1)
      );
      this.metrics?.backfillSync.totalBlocks.inc({method: BackfillSyncMethod.rangesync}, verifiedBlocks.length);
    }

    // If nextAnchor provided, found some linear anchored blocks
    if (nextAnchor !== null) {
      this.syncAnchor = {
        anchorBlock: nextAnchor.block,
        anchorBlockRoot: nextAnchor.root,
        anchorSlot: nextAnchor.slot,
        lastBackSyncedBlock: nextAnchor,
      };
      this.logger.verbose(`syncRange discovered ${verifiedBlocks.length} valid blocks`, {
        backfilled: this.syncAnchor.lastBackSyncedBlock.slot,
      });
    }
    if (error) throw new BackfillSyncError({code: error});
  }
}

async function extractPreviousFinOrWsCheckpoint(
  config: IChainForkConfig,
  db: IBeaconDb,
  belowSlot: Slot,
  logger?: ILogger
): Promise<BackfillBlockHeader> {
  // Anything below genesis block is just zero hash
  if (belowSlot <= GENESIS_SLOT) return {root: ZERO_HASH, slot: belowSlot - 1};

  // To extract the next prevFinalizedCheckpointBlock, we just need to look back in DB
  // Any saved previous finalized or ws checkpoint, will also have a corresponding block
  // saved in DB, as we make sure of that
  //   1. When we archive new finalized state and blocks
  //   2. When we backfill from a wsCheckpoint
  const nextPrevFinOrWsBlock = (
    await db.blockArchive.values({
      lt: belowSlot,
      reverse: true,
      limit: 1,
    })
  )[0];

  let prevFinalizedCheckpointBlock: BackfillBlockHeader;
  if (nextPrevFinOrWsBlock != null) {
    const header = blockToHeader(config, nextPrevFinOrWsBlock.message);
    const root = ssz.phase0.BeaconBlockHeader.hashTreeRoot(header);
    prevFinalizedCheckpointBlock = {root, slot: nextPrevFinOrWsBlock.message.slot};
    logger?.debug("Extracted new prevFinalizedCheckpointBlock as potential previous finalized or wsCheckpoint", {
      root: toHexString(prevFinalizedCheckpointBlock.root),
      slot: prevFinalizedCheckpointBlock.slot,
    });
  } else {
    // GENESIS_SLOT -1 is the placeholder for parentHash of the genesis block
    // which should always be ZERO_HASH.
    prevFinalizedCheckpointBlock = {root: ZERO_HASH, slot: GENESIS_SLOT - 1};
  }
  return prevFinalizedCheckpointBlock;
}
