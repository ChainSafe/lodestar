/**
 * @module sync
 */

import assert from "assert";
import PeerInfo from "peer-info";

import {IBeaconDb} from "../db";
import {IBeaconChain} from "../chain";
import {SyncRpc} from "./rpc";
import {INetwork} from "../network";
import {ReputationStore} from "./reputation";
import {ILogger} from "../logger";
import {SLOTS_PER_EPOCH} from "../constants";
import {BeaconBlockHeadersResponse, BeaconBlockBodiesResponse, BeaconBlock} from "../types";

export class InitialSync {
  private db: IBeaconDb;
  private chain: IBeaconChain;
  private rpc: SyncRpc;
  private network: INetwork;
  private reps: ReputationStore;
  private logger: ILogger;
  public constructor(opts, {db, chain, rpc, network, reps, logger}) {
    this.db = db;
    this.chain = chain;
    this.rpc = rpc;
    this.network = network;
    this.reps = reps;
    this.logger = logger;
  }
  public async syncToPeers(): Promise<void> {
    // Sort peers from best to worst
    const peers = this.network.getPeers().sort((peerA, peerB) => {
      const repA = this.reps.get(peerA.id.toB58String());
      const repB = this.reps.get(peerB.id.toB58String());
      if (!repA.latestHello) {
        return -1;
      }
      if (!repB.latestHello) {
        return 1;
      }
      return repA.latestHello.bestSlot - repB.latestHello.bestSlot;
    });
    // Try to sync to a peer
    for (const peer of peers) {
      try {
        await this.syncToPeer(peer);
        break;
      } catch (e) {
        this.logger.warn("Failed to sync with peer, trying next best peer", e);
      }
    }
  }
  public async syncToPeer(peerInfo: PeerInfo): Promise<void> {
    const peerLatestHello = this.reps.get(peerInfo.id.toB58String()).latestHello;
    // Set latest finalized state
    const finalizedRoot = peerLatestHello.latestFinalizedRoot;
    const stateResponse = await this.rpc.getBeaconStates(peerInfo, [peerLatestHello.latestFinalizedRoot]);
    assert(stateResponse.states.length === 1);
    const state = stateResponse.states[0];
    await Promise.all([
      this.db.setLatestStateRoot(finalizedRoot, state),
      this.db.setFinalizedStateRoot(finalizedRoot, state),
      this.db.setJustifiedStateRoot(finalizedRoot, state),
    ]);
    // fetch recent blocks and push into the chain
    const latestFinalizedSlot = peerLatestHello.latestFinalizedEpoch * SLOTS_PER_EPOCH;
    const slotCountToSync = peerLatestHello.bestSlot - latestFinalizedSlot;
    const blockRootsResponse = await this.rpc.getBeaconBlockRoots(peerInfo, latestFinalizedSlot, slotCountToSync);
    assert(blockRootsResponse.roots.length > 0);
    const blockRoots = blockRootsResponse.roots;
    const [
      blockHeadersResponse,
      blockBodiesResponse
    ]: [BeaconBlockHeadersResponse, BeaconBlockBodiesResponse] = await Promise.all([
      this.rpc.getBeaconBlockHeaders(peerInfo, blockRoots[0].blockRoot, blockRoots[0].slot, blockRoots[blockRoots.length - 1].slot, 0),
      this.rpc.getBeaconBlockBodies(peerInfo, blockRoots.map((b) => b.blockRoot)),
    ]);
    assert(blockHeadersResponse.headers.length === blockBodiesResponse.blockBodies.length);
    for (let i = 0; i < blockHeadersResponse.headers.length; i++) {
      const header = blockHeadersResponse.headers[i];
      delete header.bodyRoot;
      const body = blockBodiesResponse.blockBodies[i];
      const block: BeaconBlock = {
        ...header,
        body,
      };
      await this.chain.receiveBlock(block);
    }
  }
  public async start(): Promise<void> {
    await this.syncToPeers();
  }
  public async stop(): Promise<void> {
  }
}

