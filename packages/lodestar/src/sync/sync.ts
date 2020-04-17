import {IBeaconSync, ISyncModules} from "./interface";
import {ISyncOptions} from "./options";
import {INetwork} from "../network";
import {ReputationStore} from "./IReputation";
import {sleep} from "../util/sleep";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {Root, SignedBeaconBlock, SyncingStatus} from "@chainsafe/lodestar-types";
import {FastSync, InitialSync} from "./initial";
import {IRegularSync} from "./regular";
import {BeaconReqRespHandler, IReqRespHandler} from "./reqResp";
import {BeaconGossipHandler, IGossipHandler} from "./gossip";
import {RoundRobinArray} from "./utils/robin";
import {IBeaconChain} from "../chain";
import {NaiveRegularSync} from "./regular/naive";

export enum SyncMode {
  WAITING_PEERS,
  INITIAL_SYNCING,
  REGULAR_SYNCING,
  SYNCED
}

export class BeaconSync implements IBeaconSync {

  private readonly opts: ISyncOptions;
  private readonly logger: ILogger;
  private readonly network: INetwork;
  private readonly chain: IBeaconChain;
  private readonly peerReputations: ReputationStore;

  private mode: SyncMode = SyncMode.WAITING_PEERS;
  private initialSync: InitialSync;
  private regularSync: IRegularSync;
  private reqResp: IReqRespHandler;
  private gossip: IGossipHandler;

  constructor(opts: ISyncOptions, modules: ISyncModules) {
    this.opts = opts;
    this.network = modules.network;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this.peerReputations = modules.reputationStore;
    this.peerReputations = modules.reputationStore;
    this.initialSync = modules.initialSync || new FastSync(opts, modules);
    this.regularSync = modules.regularSync || new NaiveRegularSync(opts, modules);
    this.reqResp = modules.reqRespHandler || new BeaconReqRespHandler(modules);
    this.gossip = modules.gossipHandler || new BeaconGossipHandler(modules.chain, modules.network, modules.opPool);
  }

  public async start(): Promise<void> {
    await this.reqResp.start();
    this.chain.on("unknownBlockRoot", this.onUnknownBlockRoot);
    // so we don't wait indefinitely
    (async () => {
      await this.waitForPeers(); 
      await this.startInitialSync();
      await this.startRegularSync();
      await this.gossip.start();
    })();
  }

  public async stop(): Promise<void> {
    this.chain.removeListener("unknownBlockRoot", this.onUnknownBlockRoot);
    await this.initialSync.stop();
    await this.regularSync.stop();
    await this.reqResp.stop();
    await this.gossip.stop();
  }

  public getSyncStatus(): SyncingStatus|null {
    throw new Error("Method not implemented.");
  }

  public isSynced(): boolean {
    return this.mode !== SyncMode.SYNCED;
  }

  private async startInitialSync(): Promise<void> {
    this.mode = SyncMode.INITIAL_SYNCING;
    await this.regularSync.stop();
    await this.initialSync.start();
  }

  private async startRegularSync(): Promise<void> {
    this.mode = SyncMode.REGULAR_SYNCING;
    await this.initialSync.stop();
    await this.regularSync.start();
  }
  
  private async waitForPeers(): Promise<void> {
    this.logger.info("Waiting for peers...", this.getPeers());
    while (this.getPeers().length <= this.opts.minPeers) {
      await sleep(3000);
    }
  }

  private getPeers(): PeerInfo[] {
    return this.network.getPeers()
      .filter((peer) => {
        return !!this.peerReputations.getFromPeerInfo(peer).latestStatus;
      });
  }

  private onUnknownBlockRoot = async (root: Root): Promise<void> => {
    const peerBalancer = new RoundRobinArray(this.getPeers());
    let peer = peerBalancer.next();
    let block: SignedBeaconBlock;
    while (!block && peer) {
      block = (await this.network.reqResp.beaconBlocksByRoot(peer, [root]))[0];
      peer = peerBalancer.next();
    }
    if(block) {
      await this.chain.receiveBlock(block);
    }
  };
}