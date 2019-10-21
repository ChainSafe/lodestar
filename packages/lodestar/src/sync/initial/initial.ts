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
import {chunkify, getTargetEpoch, IChunk} from "../utils/sync";
import {BeaconBlock, Checkpoint, Epoch} from "@chainsafe/eth2.0-types";
import {computeStartSlotOfEpoch} from "../../chain/stateTransition/util";
import {RoundRobinArray} from "../utils/robin";

export class InitialSync extends (EventEmitter as { new(): InitialSyncEventEmitter }) implements InitialSyncEventEmitter {

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
    const chainCheckPoint = this.chain.latestState.finalizedCheckpoint;
    //listen on finalization events
    this.chain.on("finalizedCheckpoint", this.sync);
    //start syncing from current chain checkpoint
    this.sync(chainCheckPoint);
  }

  public async stop(): Promise<void> {
    this.logger.info("initial sync stop");
    this.chain.removeListener("finalizedCheckpoint", this.sync);
  }

  private sync = async (finalizedCheckPoint: Checkpoint) => {
    const peers = Array.from(this.peers);
    const targetEpoch = getTargetEpoch(peers.map(this.reps.getFromPeerInfo), finalizedCheckPoint);
    if(finalizedCheckPoint.epoch === targetEpoch) {
      this.logger.info("Chain already on latest finalized state");
      this.chain.removeListener("finalizedCheckpoint", this.sync);
      this.emit("sync:completed", finalizedCheckPoint);
    } else {
      this.logger.debug(`Fast syncing to target ${targetEpoch}`);
      const blocks = await this.syncToTarget(targetEpoch);
      //TODO: verify block headers and run state transition without signature verification
      blocks.forEach((block) => this.chain.receiveBlock(block, true));
      this.emit("sync:checkpoint", targetEpoch);
    }
  };

  private async syncToTarget(targetEpoch: Epoch): Promise<BeaconBlock[]> {
    const currentSlot = this.chain.latestState.slot;
    const targetSlot = computeStartSlotOfEpoch(this.config, targetEpoch);
    let chunks = chunkify(this.opts.blockPerChunk, currentSlot, targetSlot);
    const blocks: BeaconBlock[] = [];
    //try to fetch chunks from different peers until all chunks are fetched
    while(chunks.length > 0) {
      //rotate peers
      const peers = new RoundRobinArray(this.peers);
      chunks = (await Promise.all(
        chunks.map(async (chunk) => {
          try {
            const chunkBlocks = await this.fetchChunk(peers.next(), chunk);
            blocks.concat(chunkBlocks);
            return null;
          } catch (e) {
            //if failed to obtain blocks, try in next round on another peer
            return chunk;
          }
        })
      )).filter((chunk) => chunk === null);
    }
    return blocks;
  }

  private async fetchChunk(peer: PeerInfo, chunk: IChunk): Promise<BeaconBlock[]> {
    const peerLatestHello = this.reps.get(peer.id.toB58String()).latestHello;
    return await this.rpc.beaconBlocksByRange(
      peer,
      {
        headBlockRoot: peerLatestHello.headRoot,
        startSlot: chunk.start,
        step: 1,
        count: chunk.end - chunk.start
      }
    );
  }
}
