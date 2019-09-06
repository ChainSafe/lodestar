/**
 * @module sync
 */

import PeerInfo from "peer-info";

import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IBeaconDb} from "../db";
import {IBeaconChain} from "../chain";
import {INetwork} from "../network";
import {ReputationStore} from "./reputation";
import {ILogger} from "../logger";

interface InitialSyncModules {
  config: IBeaconConfig;
  db: IBeaconDb;
  chain: IBeaconChain;
  network: INetwork;
  reps: ReputationStore;
  logger: ILogger;
}

export class InitialSync {
  private config: IBeaconConfig;
  private db: IBeaconDb;
  private chain: IBeaconChain;
  private network: INetwork;
  private reps: ReputationStore;
  private logger: ILogger;
  public constructor(opts, {config, db, chain, network, reps, logger}: InitialSyncModules) {
    this.config = config;
    this.db = db;
    this.chain = chain;
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
      return repA.latestHello.headSlot - repB.latestHello.headSlot;
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
    // fetch recent blocks and push into the chain
    const startSlot = this.chain.latestState.slot;
    const {blocks} = await this.network.reqResp.beaconBlocks(peerInfo, {
      headBlockRoot: peerLatestHello.headRoot,
      startSlot,
      count: peerLatestHello.headSlot - startSlot,
      step: 1,
    });
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
