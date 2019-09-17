/**
 * @module sync
 */

import BN from "bn.js";
import PeerInfo from "peer-info";
import {
  BeaconBlock,
  BeaconBlocksRequest,
  BeaconBlocksResponse,
  Epoch,
  Goodbye,
  Hash,
  Hello,
  RecentBeaconBlocksRequest,
  RecentBeaconBlocksResponse,
  RequestBody,
  Slot,
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {Method, RequestId, ZERO_HASH} from "../../constants";
import {IBeaconDb} from "../../db";
import {IBeaconChain} from "../../chain";
import {INetwork} from "../../network";
import {ILogger} from "../../logger";
import {ISyncOptions, ISyncReqResp} from "./interface";
import {ReputationStore} from "../IReputation";

export interface ISyncReqRespModules {
  config: IBeaconConfig;
  db: IBeaconDb;
  chain: IBeaconChain;
  network: INetwork;
  reps: ReputationStore;
  logger: ILogger;
}

/**
 * The SyncReqResp module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export class SyncReqResp implements ISyncReqResp {
  private opts: ISyncOptions;
  private config: IBeaconConfig;
  private db: IBeaconDb;
  private chain: IBeaconChain;
  private network: INetwork;
  private reps: ReputationStore;
  private logger: ILogger;

  public constructor(opts: ISyncOptions, {config, db, chain, network, reps, logger}: ISyncReqRespModules) {
    this.config = config;
    this.opts = opts;
    this.db = db;
    this.chain = chain;
    this.network = network;
    this.reps = reps;
    this.logger = logger;
  }

  public async onRequest(
    peerInfo: PeerInfo,
    method: Method,
    id: RequestId,
    body: RequestBody,
  ): Promise<void> {
    switch (method) {
      case Method.Hello:
        return await this.onHello(peerInfo, id, body as Hello);
      case Method.Goodbye:
        return await this.onGoodbye(peerInfo, id, body as Goodbye);
      case Method.BeaconBlocks:
        return await this.onBeaconBlocks(id, body as BeaconBlocksRequest);
      case Method.RecentBeaconBlocks:
        return await this.onRecentBeaconBlocks(id, body as RecentBeaconBlocksRequest);
      default:
        this.logger.error(`Invalid request method ${method} from ${peerInfo.id.toB58String()}`);
    }
  }

  public async onHello(peerInfo: PeerInfo, id: RequestId, request: Hello): Promise<void> {
    // set hello on peer
    this.reps.get(peerInfo.id.toB58String()).latestHello = request;
    // send hello response
    try {
      const hello = await this.createHello();
      this.network.reqResp.sendResponse(id, null, hello);
    } catch (e) {
      this.network.reqResp.sendResponse(id, e, null);
    }
    // TODO handle incorrect forkVersion or disjoint finalizedCheckpoint
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async onGoodbye(peerInfo: PeerInfo, id: RequestId, request: Goodbye): Promise<void> {
    await this.network.disconnect(peerInfo);
  }

  public async onBeaconBlocks(id: RequestId, request: BeaconBlocksRequest): Promise<void> {
    try {
      const response: BeaconBlocksResponse = {
        blocks: [],
      };
      for (let slot = request.startSlot; slot < request.startSlot + request.count; slot++) {
        const block = await this.db.block.getBlockBySlot(slot);
        if (block) {
          response.blocks.push(block);
        }
      }
      this.network.reqResp.sendResponse(id, null, response);
    } catch (e) {
      this.network.reqResp.sendResponse(id, e, null);
    }
  }

  public async onRecentBeaconBlocks(
    id: RequestId,
    request: RecentBeaconBlocksRequest
  ): Promise<void> {
    try {
      const response: RecentBeaconBlocksResponse = {
        blocks: [],
      };
      for (const blockRoot of request.blockRoots) {
        const block = await this.db.block.get(blockRoot as Buffer);
        response.blocks.push(block as BeaconBlock);
      }
      this.network.reqResp.sendResponse(id, null, response);
    } catch (e) {
      this.network.reqResp.sendResponse(id, e, null);
    }
  }

  // service

  public async start(): Promise<void> {
    this.network.on("peer:connect", this.handshake);
    await Promise.all(
      this.network.getPeers().map(async (peerInfo) =>
        this.network.reqResp.hello(peerInfo, await this.createHello())));
  }

  public async stop(): Promise<void> {
    this.network.removeListener("peer:connect", this.handshake);
    await Promise.all(
      this.network.getPeers().map((peerInfo) =>
        this.network.reqResp.goodbye(peerInfo, {reason: new BN(0)})));
  }

  private async createHello(): Promise<Hello> {
    let headSlot: Slot,
      headRoot: Hash,
      finalizedEpoch: Epoch,
      finalizedRoot: Hash;
    if (!this.chain.isInitialized()) {
      headSlot = 0;
      headRoot = ZERO_HASH;
      finalizedEpoch = 0;
      finalizedRoot = ZERO_HASH;
    } else {
      headSlot = await this.db.chain.getChainHeadSlot() as Slot;
      const [bRoot, state] = await Promise.all([
        this.db.chain.getBlockRoot(headSlot),
        this.db.state.getLatest(),
      ]);
      headRoot = bRoot as Hash;
      finalizedEpoch = state.finalizedCheckpoint.epoch;
      finalizedRoot = state.finalizedCheckpoint.root;
    }
    return {
      forkVersion: this.chain.latestState ? this.chain.latestState.fork.currentVersion : Buffer.alloc(0),
      finalizedRoot,
      finalizedEpoch,
      headRoot,
      headSlot,
    };
  }

  private handshake = async (peerInfo: PeerInfo): Promise<void> => {
    const randomDelay = Math.floor(Math.random() * 5000);
    await new Promise((resolve) => setTimeout(resolve, randomDelay));
    if (
      this.network.hasPeer(peerInfo) &&
        !this.reps.get(peerInfo.id.toB58String()).latestHello
    ) {
      const request = await this.createHello();
      try {
        await this.network.reqResp.hello(peerInfo, request);
        this.reps.get(peerInfo.id.toB58String()).latestHello = request;
      } catch (e) {
        this.logger.warn(`Handshake failed because ${e.message}`);
      }
    }
  };
}
