/**
 * @module sync/initial
 */
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconChain} from "../../../chain";
import {IReputationStore} from "../../IReputation";
import {INetwork} from "../../../network";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {ISyncOptions} from "../../options";
import {IInitialSyncModules, InitialSync, InitialSyncEventEmitter} from "../interface";
import {EventEmitter} from "events";
import {Checkpoint, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import pushable, {Pushable} from "it-pushable";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import pipe from "it-pipe";
import {toHexString} from "@chainsafe/ssz";
import {ISlotRange} from "../../interface";
import {fetchBlockChunks, getCommonFinalizedCheckpoint, processSyncBlocks} from "../../utils";
import {GENESIS_EPOCH} from "../../../constants";
import {ISyncStats, SyncStats} from "../../stats";

export class FastSync
  extends (EventEmitter as { new(): InitialSyncEventEmitter })
  implements InitialSync {

  private readonly opts: ISyncOptions;
  private readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;
  private readonly reps: IReputationStore;
  private readonly network: INetwork;
  private readonly logger: ILogger;
  private readonly stats: ISyncStats;

  /**
   * Targeted finalized checkpoint. Initial sync should only sync up to that point.
   */
  private targetCheckpoint: Checkpoint;
  /**
   * Target slot for block import, we won't download blocks past that point.
   */
  private blockImportTarget: Slot = 0;

  /**
   * Trigger for block import
   */
  private syncTriggerSource: Pushable<ISlotRange>;

  public constructor(
    opts: ISyncOptions,
    {config, chain, network, reputationStore, logger, stats}: IInitialSyncModules
  ) {
    super();
    this.config = config;
    this.chain = chain;
    this.reps = reputationStore;
    this.opts = opts;
    this.network = network;
    this.logger = logger;
    this.stats = stats || new SyncStats(this.chain);
    this.syncTriggerSource = pushable<ISlotRange>();
  }

  public async start(): Promise<void> {
    this.logger.info("Starting initial syncing");
    this.chain.on("processedCheckpoint", this.checkSyncCompleted);
    this.chain.on("processedBlock", this.checkSyncProgress);
    this.syncTriggerSource = pushable<ISlotRange>();
    this.blockImportTarget = this.chain.forkChoice.headBlockSlot();
    this.targetCheckpoint = getCommonFinalizedCheckpoint(
      this.config,
      this.network.getPeers().map((peer) => this.reps.getFromPeerInfo(peer))
    );
    if(
      !this.targetCheckpoint
        || this.targetCheckpoint.epoch == GENESIS_EPOCH
        || this.targetCheckpoint.epoch <= computeEpochAtSlot(this.config, this.blockImportTarget)
    ) {
      this.logger.info("No peers with higher finalized epoch");
      await this.stop();
      return;
    }
    this.setBlockImportTarget();
    await this.stats.start();
    await this.sync();
  }

  public async stop(): Promise<void> {
    this.logger.info("initial sync stop");
    await this.stats.stop();
    this.syncTriggerSource.end();
    this.chain.removeListener("processedBlock", this.checkSyncProgress);
    this.chain.removeListener("processedCheckpoint", this.checkSyncCompleted);
  }

  public getHighestBlock(): Slot {
    return computeStartSlotAtEpoch(this.config, this.targetCheckpoint.epoch);
  }

  private getNewBlockImportTarget(fromSlot?: Slot): Slot {
    const headSlot = fromSlot || this.chain.forkChoice.headBlockSlot();
    const finalizedTargetSlot = this.getHighestBlock();
    if(headSlot + this.opts.maxSlotImport > finalizedTargetSlot) {
      //first slot of epoch is skip slot
      return headSlot + this.config.params.SLOTS_PER_EPOCH;
    } else {
      return headSlot + this.opts.maxSlotImport;
    }
  }

  private updateBlockImportTarget = (target: Slot): void => {
    this.logger.verbose(`updating block target ${target}`);
    this.blockImportTarget = target;
  };

  private setBlockImportTarget = (fromSlot?: Slot): void => {
    const lastTarget = fromSlot || this.blockImportTarget;
    const newTarget = this.getNewBlockImportTarget(this.blockImportTarget);
    this.logger.info(
      `Fetching blocks for ${lastTarget + 1}...${newTarget} slot range`
    );
    this.syncTriggerSource.push(
      {start: lastTarget + 1, end: newTarget}
    );
    this.updateBlockImportTarget(newTarget);
  };

  private async sync(): Promise<void> {
    await pipe(
      this.syncTriggerSource,
      async (source) => {
        const config = this.config;
        const chain = this.chain;
        const network = this.network;
        const logger = this.logger;
        const opts = this.opts;
        const setBlockImportTarget = this.setBlockImportTarget;
        const updateBlockImportTarget = this.updateBlockImportTarget;
        const getInitialSyncPeers = this.getInitialSyncPeers;
        return (async function() {
          for await (const slotRange of source) {
            const lastSlot = await pipe(
              [slotRange],
              fetchBlockChunks(
                logger, chain, network.reqResp, getInitialSyncPeers, opts.blockPerChunk
              ),
              processSyncBlocks(config, chain, logger, true)
            );
            logger.verbose("last fetched slot=" + lastSlot);
            if(lastSlot) {
              //set new target from last block we've received
              // it will trigger new sync once last block is processed
              updateBlockImportTarget(lastSlot);
            } else {
              logger.warn("Didn't receive any valid block in given range");
              //we didn't receive any block, set target from last requested slot
              setBlockImportTarget(slotRange.end);
            }
          }
        })();
      }
    );
  }

  private checkSyncProgress = async (processedBlock: SignedBeaconBlock): Promise<void> => {
    if(processedBlock.message.slot === this.blockImportTarget) {
      this.setBlockImportTarget();
    }
  };

  private checkSyncCompleted = async (processedCheckpoint: Checkpoint): Promise<void> => {
    const estimate = this.stats.getEstimate(
      computeStartSlotAtEpoch(this.config, processedCheckpoint.epoch),
      this.getHighestBlock()
    );
    this.logger.important(`Sync progress - currentEpoch=${processedCheckpoint.epoch},`
        +` targetEpoch=${this.targetCheckpoint.epoch}, speed=${this.stats.getSyncSpeed().toFixed(1)} slots/s`
        +`, estimateTillComplete=${Math.round((estimate/3600) * 10)/10} hours`
    );
    if(processedCheckpoint.epoch === this.targetCheckpoint.epoch) {
      if(!this.config.types.Root.equals(processedCheckpoint.root, this.targetCheckpoint.root)) {
        this.logger.error("Different finalized root. Something fishy is going on: "
        + `expected ${toHexString(this.targetCheckpoint.root)}, actual ${toHexString(processedCheckpoint.root)}`);
        throw new Error("Should delete chain and start again. Invalid blocks synced");
      }
      const newTarget = getCommonFinalizedCheckpoint(
        this.config,
        this.network.getPeers().map((peer) => this.reps.getFromPeerInfo(peer))
      );
      if(newTarget.epoch > this.targetCheckpoint.epoch) {
        this.targetCheckpoint = newTarget;
        this.setBlockImportTarget();
        return;
      }
      //finished initial sync
      await this.stop();
    }
  };

  /**
   * Returns peers which has same finalized Checkpoint
   */
  private getInitialSyncPeers = async (): Promise<PeerInfo[]> => {
    return this.network.getPeers().reduce( (validPeers: PeerInfo[], peer: PeerInfo) => {
      const rep = this.reps.getFromPeerInfo(peer);
      if(rep && rep.latestStatus) {
        validPeers.push(peer);
      }
      return validPeers;
    }, [] as PeerInfo[]);
  };
}
