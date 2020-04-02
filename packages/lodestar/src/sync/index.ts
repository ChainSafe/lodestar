/**
 * @module sync
 */

import {EventEmitter} from "events";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconChain} from "../chain";
import {INetwork} from "../network";
import {OpPool} from "../opPool";
import {IEth1Notifier} from "../eth1";
import {IBeaconDb} from "../db";
import {FastSync, InitialSync} from "./initial";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {ISyncOptions} from "./options";
import {ISyncReqResp, SyncReqResp} from "./reqResp";
import {ReputationStore} from "./IReputation";
import {NaiveRegularSync} from "./regular/naive/naive";
import {IRegularSync} from "./regular/interface";
import {isValidPeerForInitSync} from "./utils/sync";

export interface ISyncModules {
  config: IBeaconConfig;
  chain: IBeaconChain;
  db: IBeaconDb;
  eth1: IEth1Notifier;
  network: INetwork;
  opPool: OpPool;
  reps: ReputationStore;
  logger: ILogger;
}

/**
 * The Sync service syncing data between the network and the local chain
 * The strategy may differ depending on whether the chain is synced or not
 */
export class Sync extends EventEmitter {

  public regularSync: IRegularSync;

  private opts: ISyncOptions;
  private config: IBeaconConfig;
  private chain: IBeaconChain;
  private network: INetwork;
  private opPool: OpPool;
  private reqResp: ISyncReqResp;
  private reps: ReputationStore;
  private logger: ILogger;
  //array of valid peers (peer on same fork)
  private readonly peers: PeerInfo[] = [];
  private initialSync: InitialSync;
  private waitingForPeer = true;
  private peerCheckingTimeout: NodeJS.Timeout;

  public constructor(opts: ISyncOptions, modules: ISyncModules) {
    super();
    this.opts = opts;
    this.config = modules.config;
    this.chain = modules.chain;
    this.network = modules.network;
    this.opPool = modules.opPool;
    this.reps = modules.reps;
    this.logger = modules.logger;
    this.reqResp = new SyncReqResp(opts, modules);
    this.regularSync = new NaiveRegularSync(this.opts, {...modules, peers: this.peers});
    this.initialSync = new FastSync(
      this.opts,
      {
        ...modules,
        //let it keep reference to peers
        peers: this.peers
      }
    );
  }

  public async start(): Promise<void> {
    await this.reqResp.start();
    this.initialSync.on("sync:completed", this.startRegularSync);
    this.peers.concat(await this.getValidPeers());
    this.network.on("peer:disconnect", this.handleLostPeer);
    this.network.on("peer:connect", this.handleNewPeer);
    this.startInitialSync();
  }

  public async stop(): Promise<void> {
    if(this.peerCheckingTimeout) {
      clearTimeout(this.peerCheckingTimeout);
    }
    await this.reqResp.stop();
    await this.initialSync.stop();
    await this.regularSync.stop();
  }

  public isSynced(): boolean {
    return false;
  }

  private startInitialSync = async (): Promise<void> => {
    if((await this.getValidPeers()).length >= 1) {
      this.waitingForPeer = false;
      this.initialSync.start();
    } else {
      this.logger.warn("No peers. Waiting to connect to peer...");
      this.peerCheckingTimeout = setTimeout(this.startInitialSync, 2000);
    }
  };

  private startRegularSync = async (): Promise<void> => {
    this.emit("regularSyncStarted");
    await this.initialSync.stop();
    this.regularSync.start();
  };

  private async getValidPeers(): Promise<PeerInfo[]> {
    const myState = await this.chain.getHeadState();
    return this.network.getPeers().filter(
      (peer) => isValidPeerForInitSync(this.config, myState, this.reps.get(peer.id.toB58String()).latestStatus));
  }

  private handleNewPeer = async (peer: PeerInfo): Promise<void> => {
    this.peers.push(peer);
    const myState = await this.chain.getHeadState();
    if(this.waitingForPeer &&
      isValidPeerForInitSync(this.config, myState, this.reps.get(peer.id.toB58String()).latestStatus)) {
      this.waitingForPeer = false;
      this.initialSync.start();
    }
  };

  private handleLostPeer = (peer: PeerInfo): void => {
    const index = this.peers.indexOf(peer);
    if (index !== -1) {
      this.peers.splice(index, 1);
    }
  };
}
