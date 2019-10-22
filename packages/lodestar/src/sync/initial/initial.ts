/**
 * @module sync/initial
 */
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IBeaconChain} from "../../chain";
import {ReputationStore} from "../IReputation";
import {IReqResp} from "../../network";
import {ILogger} from "../../logger";
import {ISyncOptions} from "../options";
import {IInitialSyncModules, InitialSyncEventEmitter} from "./interface";
import {EventEmitter} from "events";
import {getTargetEpoch, isValidHeaderChain} from "../utils/sync";
import {BeaconState, Checkpoint} from "@chainsafe/eth2.0-types";
import {computeStartSlotOfEpoch} from "../../chain/stateTransition/util";
import {getBlockRange} from "../utils/blocks";

export class InitialSync
  extends (EventEmitter as { new(): InitialSyncEventEmitter })
  implements InitialSyncEventEmitter {

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
    this.chain.on("processedEpoch", this.sync);
    //start syncing from current chain checkpoint
    await this.sync(chainCheckPoint);
  }

  public async stop(): Promise<void> {
    this.logger.info("initial sync stop");
    this.chain.removeListener("processedEpoch", this.sync);
  }

  private sync = async (chainCheckPoint: Checkpoint) => {
    const peers = Array.from(this.peers);
    const targetEpoch = getTargetEpoch(peers.map(this.reps.getFromPeerInfo), chainCheckPoint);
    if(chainCheckPoint.epoch >= targetEpoch) {
      this.logger.info("Chain already on latest finalized state");
      this.chain.removeListener("processedEpoch", this.sync);
      this.emit("sync:completed", chainCheckPoint);
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
      if(isValidHeaderChain(this.config, latestState.latestBlockHeader, blocks)) {
        blocks.forEach((block) => this.chain.receiveBlock(block, true));
        this.emit("sync:checkpoint", targetEpoch);
      } else {
        this.logger.error(`Invalid header chain (${latestState.slot}...`
            + `${computeStartSlotOfEpoch(this.config, targetEpoch)}), blocks discarded. Retrying...`
        );
        await this.sync(chainCheckPoint);
      }
    }
  };


}
