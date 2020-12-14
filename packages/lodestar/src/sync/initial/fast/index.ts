/**
 * @module sync/initial
 */
import PeerId from "peer-id";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SlotRoot} from "@chainsafe/lodestar-types";
import {ChainEvent, IBeaconChain} from "../../../chain";
import {getSyncProtocols, INetwork} from "../../../network";
import {ILogger} from "@chainsafe/lodestar-utils";
import {defaultSyncOptions, ISyncOptions} from "../../options";
import {IInitialSyncModules, InitialSync, InitialSyncEventEmitter} from "../interface";
import {EventEmitter} from "events";
import {Checkpoint, SignedBeaconBlock, Slot, Status} from "@chainsafe/lodestar-types";
import pushable, {Pushable} from "it-pushable";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import pipe from "it-pipe";
import {ISlotRange} from "../../interface";
import {fetchBlockChunks, getCommonFinalizedCheckpoint, processSyncBlocks} from "../../utils";
import {GENESIS_EPOCH} from "../../../constants";
import {ISyncStats, SyncStats} from "../../stats";
import {IBeaconDb} from "../../../db";
import {notNullish} from "../../../util/notNullish";
import {getSyncPeers} from "../../utils/peers";

export class FastSync extends (EventEmitter as {new (): InitialSyncEventEmitter}) implements InitialSync {
  private readonly opts: ISyncOptions;
  private readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;
  private readonly network: INetwork;
  private readonly logger: ILogger;
  private readonly stats: ISyncStats;
  private readonly db: IBeaconDb;

  /**
   * Targeted finalized checkpoint. Initial sync should only sync up to that point.
   */
  private targetCheckpoint: Checkpoint | null = null;
  /**
   * Target slot for block import, we won't download blocks past that point.
   */
  private blockImportTarget: Slot = 0;

  /**
   * Trigger for block import
   */
  private syncTriggerSource: Pushable<ISlotRange>;
  /**
   * The last processed block
   */
  private lastProcessedBlock!: SlotRoot;

  public constructor(opts: ISyncOptions, {config, chain, network, logger, db, stats}: IInitialSyncModules) {
    super();
    this.config = config;
    this.chain = chain;
    this.opts = opts;
    this.network = network;
    this.logger = logger;
    this.db = db;
    this.stats = stats || new SyncStats(this.chain.emitter);
    this.syncTriggerSource = pushable<ISlotRange>();
  }

  public async start(): Promise<void> {
    this.logger.info("Starting initial syncing");
    this.chain.emitter.on(ChainEvent.checkpoint, this.checkSyncCompleted);
    this.chain.emitter.on(ChainEvent.block, this.checkSyncProgress);
    this.syncTriggerSource = pushable<ISlotRange>();
    this.targetCheckpoint = getCommonFinalizedCheckpoint(this.config, this.getPeerStatuses());
    // head may not be on finalized chain so we start from finalized block
    // there are unfinalized blocks in db so we reprocess all of them
    const finalizedBlock = this.chain.forkChoice.getFinalizedBlock();
    this.lastProcessedBlock = {slot: finalizedBlock.slot, root: finalizedBlock.blockRoot};
    this.blockImportTarget = this.lastProcessedBlock.slot;
    if (
      !this.targetCheckpoint ||
      this.targetCheckpoint.epoch == GENESIS_EPOCH ||
      this.targetCheckpoint.epoch <= this.chain.forkChoice.getFinalizedCheckpoint().epoch
    ) {
      this.logger.info("No peers with higher finalized epoch");
      await this.stop();
      return;
    }
    this.logger.info("Start initial sync", {finalizedSlot: this.blockImportTarget});
    this.setBlockImportTarget();
    await this.stats.start();
    await this.sync();
  }

  public async stop(): Promise<void> {
    this.logger.info("initial sync stop");
    await this.stats.stop();
    this.syncTriggerSource.end();
    this.chain.emitter.removeListener(ChainEvent.block, this.checkSyncProgress);
    this.chain.emitter.removeListener(ChainEvent.checkpoint, this.checkSyncCompleted);
  }

  public getHighestBlock(): Slot {
    return computeStartSlotAtEpoch(this.config, this.targetCheckpoint!.epoch);
  }

  private getNewBlockImportTarget(fromSlot: Slot): Slot {
    const finalizedTargetSlot = this.getHighestBlock();
    const maxSlotImport = this.opts.maxSlotImport ?? defaultSyncOptions.maxSlotImport;
    if (fromSlot + maxSlotImport > finalizedTargetSlot) {
      // first slot of epoch is skip slot
      return fromSlot + this.config.params.SLOTS_PER_EPOCH;
    } else {
      return fromSlot + maxSlotImport;
    }
  }

  private updateBlockImportTarget = (target: Slot): void => {
    this.logger.verbose("updating block target", {target});
    this.blockImportTarget = target;
  };

  private setBlockImportTarget = (fromSlot?: Slot): void => {
    const lastTarget = fromSlot ?? this.blockImportTarget;
    const newTarget = this.getNewBlockImportTarget(lastTarget);
    this.logger.info("Fetching blocks range", {fromSlot: lastTarget + 1, toSlot: newTarget});
    this.syncTriggerSource.push({start: lastTarget + 1, end: newTarget});
    this.updateBlockImportTarget(newTarget);
  };

  private async sync(): Promise<void> {
    await pipe(this.syncTriggerSource, async (source) => {
      const {
        config,
        chain,
        network,
        logger,
        getLastProcessedBlock,
        setBlockImportTarget,
        updateBlockImportTarget,
        getInitialSyncPeers,
      } = this;

      for await (const slotRange of source) {
        const lastSlot = await pipe(
          [slotRange],
          fetchBlockChunks(logger, network.reqResp, getInitialSyncPeers),
          processSyncBlocks(config, chain, logger, true, getLastProcessedBlock(), true)
        );
        logger.verbose("last processed slot range", {lastSlot, ...slotRange});
        if (typeof lastSlot === "number") {
          if (lastSlot === getLastProcessedBlock().slot) {
            // failed at start of range

            logger.warn("Failed to process block range, retrying", {lastSlot, ...slotRange});
            setBlockImportTarget(lastSlot);
          } else {
            // success
            // set new target from last block we've processed
            // it will trigger new sync once last block is processed
            updateBlockImportTarget(lastSlot);
          }
        } else {
          // no blocks in range
          logger.warn("Didn't receive any valid block in block range", {...slotRange});
          // we didn't receive any block, set target from last requested slot
          setBlockImportTarget(slotRange.end);
        }
      }
    });
  }

  private checkSyncProgress = async (processedBlock: SignedBeaconBlock): Promise<void> => {
    if (processedBlock.message.slot === this.blockImportTarget) {
      this.lastProcessedBlock = {
        slot: processedBlock.message.slot,
        root: this.config.types.BeaconBlock.hashTreeRoot(processedBlock.message),
      };
      this.setBlockImportTarget();
    }
  };

  private checkSyncCompleted = async (processedCheckpoint: Checkpoint): Promise<void> => {
    const estimate = this.stats.getEstimate(
      computeStartSlotAtEpoch(this.config, processedCheckpoint.epoch),
      this.getHighestBlock()
    );
    this.logger.important("Sync progress", {
      currentEpoch: processedCheckpoint.epoch,
      targetEpoch: this.targetCheckpoint!.epoch,
      speed: this.stats.getSyncSpeed().toFixed(1) + " slots/s",
      estimatedTillComplete: Math.round((estimate / 3600) * 10) / 10 + " hours",
    });
    if (processedCheckpoint.epoch === this.targetCheckpoint!.epoch) {
      // this doesn't work because finalized checkpoint root is first slot of that epoch as per ffg,
      // while our processed checkpoint has root of last slot of that epoch
      // if(!this.config.types.Root.equals(processedCheckpoint.root, this.targetCheckpoint.root)) {
      //   this.logger.error("Different finalized root. Something fishy is going on: "
      //   + `expected ${toHexString(this.targetCheckpoint.root)}, actual ${toHexString(processedCheckpoint.root)}`);
      //   throw new Error("Should delete chain and start again. Invalid blocks synced");
      // }
      const newTarget = getCommonFinalizedCheckpoint(this.config, this.getPeerStatuses())!;
      if (newTarget.epoch > this.targetCheckpoint!.epoch) {
        this.targetCheckpoint = newTarget;
        this.logger.verbose("Set new target checkpoint", {epoch: newTarget.epoch});
        return;
      }
      this.logger.important(`Reach common finalized checkpoint at epoch ${this.targetCheckpoint!.epoch}`);
      // finished initial sync
      await this.stop();
    }
  };

  private getPeerStatuses(): Status[] {
    return this.network
      .getPeers({
        connected: true,
        supportsProtocols: getSyncProtocols(),
      })
      .map((peer) => this.network.peerMetadata.getStatus(peer.id))
      .filter(notNullish);
  }

  /**
   * Make sure we get up-to-date lastProcessedBlock from sync().
   */
  private getLastProcessedBlock = (): SlotRoot => {
    return this.lastProcessedBlock;
  };

  /**
   * Returns peers which has same finalized Checkpoint
   */
  private getInitialSyncPeers = async (): Promise<PeerId[]> => {
    return getSyncPeers(this.network, (peer) => {
      const status = this.network.peerMetadata.getStatus(peer);
      return !!status && status.finalizedEpoch >= (this.targetCheckpoint?.epoch ?? 0);
    });
  };
}
