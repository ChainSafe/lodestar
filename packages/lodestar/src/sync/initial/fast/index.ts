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
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import pipe from "it-pipe";
import {toHexString} from "@chainsafe/ssz";
import {ISlotRange} from "../../interface";
import {
  fetchBlockChunks,
  getCommonFinalizedCheckpoint,
  getStatusFinalizedCheckpoint,
  processSyncBlocks
} from "../../utils";

export class FastSync
  extends (EventEmitter as { new(): InitialSyncEventEmitter })
  implements InitialSync {

  private readonly opts: ISyncOptions;
  private readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;
  private readonly reps: IReputationStore;
  private readonly network: INetwork;
  private readonly logger: ILogger;

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

  public constructor(opts: ISyncOptions, {config, chain, network, reputationStore, logger}: IInitialSyncModules) {
    super();
    this.config = config;
    this.chain = chain;
    this.reps = reputationStore;
    this.opts = opts;
    this.network = network;
    this.logger = logger;
    this.syncTriggerSource = pushable<ISlotRange>();
  }

  public async start(): Promise<void> {
    this.chain.on("processedCheckpoint", this.checkSyncCompleted);
    this.chain.on("processedBlock", this.checkSyncProgress);
    this.syncTriggerSource = pushable<ISlotRange>();
    this.targetCheckpoint = getCommonFinalizedCheckpoint(
      this.config,
      this.network.getPeers().map((peer) => this.reps.getFromPeerInfo(peer))
    );
    if(!this.targetCheckpoint || this.targetCheckpoint.epoch == 0) {
      this.logger.info("No peers with higher finalized epoch");
      return;
    }
    this.setBlockImportTarget();
    await this.sync();
    this.logger.info("Started initial syncing");
  }

  public async stop(): Promise<void> {
    this.logger.info("initial sync stop");
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


  private setBlockImportTarget = (target?: Slot, triggerSync = true): void => {
    const lastTarget = this.blockImportTarget;
    this.blockImportTarget = target || this.getNewBlockImportTarget(target);
    if(triggerSync) {
      this.logger.info(
        `Fetching blocks for ${this.chain.forkChoice.headBlockSlot()}...${this.blockImportTarget} slot range`
      );
      this.syncTriggerSource.push(
        {start: lastTarget + 1, end: this.blockImportTarget}
      );
    }
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
            if(lastSlot) {
              //set new target from last block we've received
              setBlockImportTarget(lastSlot, false);
            } else {
              //we didn't receive any block, set target from last requested slot
              setBlockImportTarget(slotRange.end, true);
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
    this.logger.info(`Sync progress - currentEpoch=${processedCheckpoint.epoch},`
        +` targetEpoch=${this.targetCheckpoint.epoch}`
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
