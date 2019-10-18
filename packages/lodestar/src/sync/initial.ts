/**
 * @module sync
 */

import PeerInfo from "peer-info";

import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IBeaconChain} from "../chain";
import {INetwork, IReqResp} from "../network";
import {ILogger} from "../logger";
import {ISyncOptions} from "./options";
import {ReputationStore} from "./IReputation";
import {BeaconBlock, Checkpoint, Epoch} from "@chainsafe/eth2.0-types";
import {equals} from "@chainsafe/ssz";
import {Chunk, chunkify, getTargetEpoch} from "./utils/sync";
import {computeStartSlotOfEpoch} from "../chain/stateTransition/util";
import {RoundRobinArray} from "./utils/robin";

interface IInitialSyncModules {
  config: IBeaconConfig;
  chain: IBeaconChain;
  network: INetwork;
  reps: ReputationStore;
  logger: ILogger;
  peers: PeerInfo[];
}

export class InitialSync {

  private config: IBeaconConfig;
  private chain: IBeaconChain;
  private reps: ReputationStore;
  private rpc: IReqResp;
  private logger: ILogger;
  private peers: PeerInfo[];

  public constructor(opts: ISyncOptions, {config, chain, network, reps, logger, peers}: IInitialSyncModules) {
    this.config = config;
    this.chain = chain;
    this.peers = peers;
    this.reps = reps;
    this.rpc = network.reqResp;
    this.logger = logger;
  }

  public async start(): Promise<void> {
    this.logger.info("initial sync start");
    const chainCheckPoint = this.chain.latestState.finalizedCheckpoint;
    //listen on finalization events
    this.chain.on("finalizedCheckpoint", this.sync);
    //start syncing from current chain checkpoint
    this.sync(chainCheckPoint);
  }

  public async stop(): Promise<void> {
    this.logger.info("initial sync stop");
  }

  private sync = async (finalizedCheckPoint: Checkpoint) => {
    const peers = Array.from(this.peers);
    const targetEpoch = getTargetEpoch(peers.map(this.reps.getFromPeerInfo), finalizedCheckPoint);
    if(finalizedCheckPoint.epoch === targetEpoch) {
      this.logger.info("Chain already on latest finalized state");
      this.emit("synced", finalizedCheckPoint);
    } else {
      this.logger.debug(`Fast syncing to target ${targetEpoch}`);
      const blocks = await this.syncToTarget(targetEpoch);
      //TODO: verify block headers and run state transition without signature verification
      blocks.forEach((block) => this.chain.receiveBlock(block, true));
    }
  };

  private async syncToTarget(targetEpoch: Epoch): Promise<BeaconBlock[]> {
    const currentSlot = this.chain.latestState.slot;
    const targetSlot = computeStartSlotOfEpoch(this.config, targetEpoch);
    let chunks = chunkify(20, currentSlot, targetSlot);
    const blocks: BeaconBlock[] = [];
    //try to fetch chunks from different peers until all chunks are fetched
    while(chunks.length > 0) {
      //rotate peers
      const peers = new RoundRobinArray(this.peers);
      chunks = (await Promise.all(
        chunks.map(async (chunk) => {
          try {
            const chunkBlocks = await this.syncChunk(peers.next(), chunk);
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

  private async syncChunk(peer: PeerInfo, chunk: Chunk): Promise<BeaconBlock[]> {
    const peerLatestHello = this.reps.get(peer.id.toB58String()).latestHello;
    return await this.rpc.beaconBlocksByRange(
      peer,
      {
        headBlockRoot: peerLatestHello.headRoot,
        startSlot: chunk[0],
        step: 1,
        count: chunk[1] - chunk[0]
      }
    );
  }
}
