/**
 * @module sync
 */

import assert from "assert";
import PeerInfo from "peer-info";

import {BeaconBlockHeadersResponse, BeaconBlockBodiesResponse, BeaconBlock} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IBeaconDb} from "../db";
import {IBeaconChain} from "../chain";
import {INetwork} from "../network";
import {ReputationStore} from "./reputation";
import {ILogger} from "../logger";
import {ISyncRpc} from "./rpc/interface";

interface InitialSyncModules {
  config: IBeaconConfig;
  db: IBeaconDb;
  chain: IBeaconChain;
  rpc: ISyncRpc;
  network: INetwork;
  reps: ReputationStore;
  logger: ILogger;
}

export class InitialSync {
  private config: IBeaconConfig;
  private db: IBeaconDb;
  private chain: IBeaconChain;
  private rpc: ISyncRpc;
  private network: INetwork;
  private reps: ReputationStore;
  private logger: ILogger;
  public constructor(opts, {config, db, chain, rpc, network, reps, logger}: InitialSyncModules) {
    this.config = config;
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
        this.logger.warn(`Failed to sync with peer ${peer.id.toB58String()}, trying next best peer`, e);
      }
    }
  }
  public async syncToPeer(peerInfo: PeerInfo): Promise<void> {
    const peerLatestHello = this.reps.get(peerInfo.id.toB58String()).latestHello;
    // Set latest finalized state
    const finalizedRoot = peerLatestHello.latestFinalizedRoot;
    const states = await this.rpc.getBeaconStates(peerInfo, [peerLatestHello.latestFinalizedRoot]);
    assert(states.length === 1);
    const state = states[0];

    await Promise.all([
      this.db.state.set(finalizedRoot, state),
      this.db.chain.setLatestStateRoot(finalizedRoot),
      this.db.chain.setFinalizedStateRoot(finalizedRoot),
      this.db.chain.setJustifiedStateRoot(finalizedRoot),
    ]);
    // fetch recent blocks and push into the chain
    const latestFinalizedSlot = peerLatestHello.latestFinalizedEpoch * this.config.params.SLOTS_PER_EPOCH;
    const slotCountToSync = peerLatestHello.bestSlot - latestFinalizedSlot;
    const blocks = await this.rpc.getBeaconBlocks(
      peerInfo, latestFinalizedSlot, slotCountToSync, false
    );
    for(const block of blocks) {
      await this.chain.receiveBlock(block);
    }

  }
  public async start(): Promise<void> {
    await this.syncToPeers();
  }
  public async stop(): Promise<void> {
  }
}

function generatePreset(name: string) {

}

export const mainnet = generatePreset("mainnet");
