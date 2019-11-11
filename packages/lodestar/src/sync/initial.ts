/**
 * @module sync
 */

import PeerInfo from "peer-info";

import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IBeaconDb} from "../db";
import {IBeaconChain} from "../chain";
import {INetwork} from "../network";
import {ILogger} from "../logger";
import {ISyncOptions} from "./options";
import {ReputationStore} from "./IReputation";

interface IInitialSyncModules {
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
  public constructor(opts: ISyncOptions, {config, db, chain, network, reps, logger}: IInitialSyncModules) {
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
      if (!repA.latestStatus) {
        return -1;
      }
      if (!repB.latestStatus) {
        return 1;
      }
      return repA.latestStatus.headSlot - repB.latestStatus.headSlot;
    });
    // Try to sync to a peer
    for (const peer of peers) {
      try {
        await this.syncToPeer(peer);
        break;
      } catch (e) {
        this.logger.warn(`Failed to sync with peer ${peer.id.toB58String()}, trying next best peer `, e);
      }
    }
  }
  public async syncToPeer(peerInfo: PeerInfo): Promise<void> {
    // fetch recent blocks and push into the chain
    let startSlot = await this.db.chain.getChainHeadSlot();
    if(startSlot ===  0) {
      startSlot += 1;
    }
    const peerLatestHello = this.reps.get(peerInfo.id.toB58String()).latestStatus;
    this.logger.info(
      `attempting initial sync with ${peerInfo.id.toB58String()}, slot ${startSlot} through ${peerLatestHello.headSlot}`
    );
    const blocks = await this.network.reqResp.beaconBlocksByRange(peerInfo, {
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
    this.logger.info("initial sync start");
    await this.syncToPeers();
  }
  public async stop(): Promise<void> {
    this.logger.info("initial sync stop");
  }
}
