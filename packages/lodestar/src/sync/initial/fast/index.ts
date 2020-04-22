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
import {Checkpoint, Slot} from "@chainsafe/lodestar-types";
import pushable, {Pushable} from "it-pushable";
import {
  fetchBlockChunks,
  getCommonFinalizedCheckpoint,
  getStatusFinalizedCheckpoint,
  processSyncBlocks,
  targetSlotToBlockChunks
} from "../../utils";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import pipe from "it-pipe";
import {toHexString} from "@chainsafe/ssz";

export class FastSync
  extends (EventEmitter as { new(): InitialSyncEventEmitter })
  implements InitialSync {

  private readonly opts: ISyncOptions;
  private readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;
  private readonly reps: IReputationStore;
  private readonly network: INetwork;
  private readonly logger: ILogger;

  private targetCheckpoint: Checkpoint;
  private syncTriggerSource: Pushable<Slot>;

  public constructor(opts: ISyncOptions, {config, chain, network, reputationStore, logger}: IInitialSyncModules) {
    super();
    this.config = config;
    this.chain = chain;
    this.reps = reputationStore;
    this.opts = opts;
    this.network = network;
    this.logger = logger;
    this.syncTriggerSource = pushable<Slot>();
  }

  public async start(): Promise<void> {
    this.logger.info("Started initial syncing");
    this.chain.on("processedCheckpoint", this.checkProgress);
    this.syncTriggerSource = pushable<Slot>();
    const target = getCommonFinalizedCheckpoint(
      this.config,
      this.network.getPeers().map((peer) => this.reps.getFromPeerInfo(peer))
    );
    if(!target || target.epoch == 0) {
      this.logger.debug("No peers with higher finalized epoch");
      return;
    }
    this.setTarget(target);
    await this.sync();
  }

  public async stop(): Promise<void> {
    this.logger.info("initial sync stop");
    this.syncTriggerSource.end();
    this.chain.removeListener("processedCheckpoint", this.checkProgress);
  }

  private setTarget = (target: Checkpoint): void => {
    this.targetCheckpoint = target;
    this.syncTriggerSource.push(computeStartSlotAtEpoch(this.config, target.epoch + 1));
  };

  private async sync(): Promise<void> {
    await pipe(
      this.syncTriggerSource,
      targetSlotToBlockChunks(this.config, this.chain),
      fetchBlockChunks(this.chain, this.network.reqResp, this.getInitialSyncPeers, this.opts.blockPerChunk),
      //validate get's executed before previous chunk is processed, chain will indirectly fail if incorrect hash
      // but sync will probably stuck
      // validateBlocks(this.config, this.chain, this.logger, this.setTarget),
      processSyncBlocks(this.chain, this.logger, true)
    );
  }
  
  private checkProgress = async (processedCheckpoint: Checkpoint): Promise<void> => {
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
        this.setTarget(newTarget);
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
      if(rep 
          && rep.latestStatus 
          && this.config.types.Checkpoint.equals(this.targetCheckpoint, getStatusFinalizedCheckpoint(rep.latestStatus))
      ) {
        validPeers.push(peer);
      }
      return validPeers;
    }, [] as PeerInfo[]);
  };
}
