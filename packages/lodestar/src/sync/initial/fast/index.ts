/**
 * @module sync/initial
 */
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IBeaconChain} from "../../../chain";
import {ReputationStore} from "../../IReputation";
import {IReqResp} from "../../../network";
import {ILogger} from "../../../logger";
import {ISyncOptions} from "../../options";
import {IInitialSyncModules, InitialSync, InitialSyncEventEmitter} from "../interface";
import {EventEmitter} from "events";
import {getSyncTargetEpoch, isValidChainOfBlocks, isValidFinalizedCheckPoint} from "../../utils/sync";
import {BeaconState, Checkpoint} from "@chainsafe/eth2.0-types";
import {computeStartSlotOfEpoch} from "@chainsafe/eth2.0-state-transition";
import {getBlockRange} from "../../utils/blocks";

export class FastSync
  extends (EventEmitter as { new(): InitialSyncEventEmitter })
  implements InitialSync {

  private config: IBeaconConfig;
  private opts: ISyncOptions;
  private chain: IBeaconChain;
  private reps: ReputationStore;
  private rpc: IReqResp;
  private logger: ILogger;
  private peers: PeerInfo[];

  public constructor(opts: ISyncOptions, {config, chain, network, reps, logger, peers}: IInitialSyncModules) {
    super();
    this.config = config;
    this.chain = chain;
    this.peers = peers;
    this.reps = reps;
    this.opts = opts;
    this.rpc = network.reqResp;
    this.logger = logger;
  }

  public async start(): Promise<void> {
    this.logger.info("initial sync start");
    if(this.peers.length === 0) {
      this.logger.error("No peers. Exiting initial sync");
      return;
    }
    if(!this.chain.isInitialized()) {
      this.logger.warn("Chain not initialized.");
      this.emit("sync:completed", null);
      return;
    }

    const chainCheckPoint = this.chain.latestState.currentJustifiedCheckpoint;
    //listen on finalization events
    this.chain.on("processedCheckpoint", this.sync);
    //start syncing from current chain checkpoint
    await this.sync(chainCheckPoint);
  }

  public async stop(): Promise<void> {
    this.logger.info("initial sync stop");
    this.chain.removeListener("processedCheckpoint", this.sync);
  }

  private sync = async (chainCheckPoint: Checkpoint): Promise<void> => {
    const peers = Array.from(this.peers).map(this.reps.getFromPeerInfo);
    const targetEpoch = getSyncTargetEpoch(peers, chainCheckPoint);
    if(chainCheckPoint.epoch >= targetEpoch) {
      if(isValidFinalizedCheckPoint(peers, chainCheckPoint)) {
        this.logger.info("Chain already on latest finalized state");
        this.chain.removeListener("processedCheckpoint", this.sync);
        this.emit("sync:completed", chainCheckPoint);
      }
      this.logger.error("Wrong chain synced, should clean and start over");
    } else {
      this.logger.debug(`Fast syncing to target ${targetEpoch}`);
      const latestState = this.chain.latestState as BeaconState;
      const blocks = await getBlockRange(
        this.rpc,
        this.reps,
        this.peers,
        {start: latestState.slot, end: computeStartSlotOfEpoch(this.config, targetEpoch)},
        this.opts.blockPerChunk
      );
      if(isValidChainOfBlocks(this.config, latestState.latestBlockHeader, blocks)) {
        blocks.forEach((block) => this.chain.receiveBlock(block, true));
        this.emit("sync:checkpoint", targetEpoch);
      } else {
        //TODO: if finalized checkpoint is wrong, sync whole chain again
        this.logger.error(`Invalid header chain (${latestState.slot}...`
            + `${computeStartSlotOfEpoch(this.config, targetEpoch)}), blocks discarded. Retrying...`
        );
        await this.sync(chainCheckPoint);
      }
    }
  };


}
