/**
 * @module sync
 */

import PeerInfo from "peer-info";
import {
  BeaconBlocksByRangeRequest,
  BeaconBlocksByRangeResponse,
  BeaconBlocksByRootRequest,
  BeaconBlocksByRootResponse,
  Epoch,
  Goodbye,
  RequestBody,
  Slot, Status, Root,
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

  public async start(): Promise<void> {
    this.network.on("peer:connect", this.handshake);
    this.network.reqResp.on("request", this.onRequest);
    await Promise.all(
      this.network.getPeers().map(async (peerInfo) =>
        this.network.reqResp.status(peerInfo, await this.createStatus())));
  }

  public async stop(): Promise<void> {
    this.network.removeListener("peer:connect", this.handshake);
    this.network.reqResp.removeListener("request", this.onRequest);
    await Promise.all(
      this.network.getPeers().map((peerInfo) =>
        this.network.reqResp.goodbye(peerInfo, 0n)));
  }

  public onRequest = async (
    peerInfo: PeerInfo,
    method: Method,
    id: RequestId,
    body: RequestBody,
  ): Promise<void> => {
    switch (method) {
      case Method.Status:
        return await this.onStatus(peerInfo, id, body as Status);
      case Method.Goodbye:
        return await this.onGoodbye(peerInfo, id, body as Goodbye);
      case Method.BeaconBlocksByRange:
        return await this.onBeaconBlocksByRange(id, body as BeaconBlocksByRangeRequest);
      case Method.BeaconBlocksByRoot:
        return await this.onBeaconBlocksByRoot(id, body as BeaconBlocksByRootRequest);
      default:
        this.logger.error(`Invalid request method ${method} from ${peerInfo.id.toB58String()}`);
    }
  };

  public async onStatus(peerInfo: PeerInfo, id: RequestId, request: Status): Promise<void> {
    // set status on peer
    this.reps.get(peerInfo.id.toB58String()).latestStatus = request;
    // send status response
    try {
      const status = await this.createStatus();
      this.network.reqResp.sendResponse(id, null, status);
    } catch (e) {
      this.network.reqResp.sendResponse(id, e, null);
    }
    // TODO handle incorrect forkVersion or disjoint finalizedCheckpoint
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async onGoodbye(peerInfo: PeerInfo, id: RequestId, request: Goodbye): Promise<void> {
    await this.network.disconnect(peerInfo);
  }

  public async onBeaconBlocksByRange(
    id: RequestId,
    request: BeaconBlocksByRangeRequest
  ): Promise<void> {
    try {
      const response: BeaconBlocksByRangeResponse = [];
      const blocks = await this.db.blockArchive.getAllBetween(request.startSlot - 1, request.startSlot + request.count);
      response.push(...blocks);
      this.network.reqResp.sendResponse(id, null, response);
    } catch (e) {
      this.network.reqResp.sendResponse(id, e, null);
    }
  }

  public async onBeaconBlocksByRoot(
    id: RequestId,
    request: BeaconBlocksByRootRequest
  ): Promise<void> {
    try {
      const response: BeaconBlocksByRootResponse = [];
      for (const blockRoot of request) {
        const block = await this.db.block.get(blockRoot);
        if (block) {
          response.push(block);
        }
      }
      this.network.reqResp.sendResponse(id, null, response);
    } catch (e) {
      this.network.reqResp.sendResponse(id, e, null);
    }
  }

  private async createStatus(): Promise<Status> {
    let headSlot: Slot,
      headRoot: Root,
      finalizedEpoch: Epoch,
      finalizedRoot: Root;
    if (!this.chain.isInitialized()) {
      headSlot = 0;
      headRoot = ZERO_HASH;
      finalizedEpoch = 0;
      finalizedRoot = ZERO_HASH;
    } else {
      headSlot = await this.db.chain.getChainHeadSlot();
      const [bRoot, state] = await Promise.all([
        this.db.chain.getBlockRoot(headSlot),
        this.db.state.getLatest(),
      ]);
      headRoot = bRoot;
      finalizedEpoch = state.finalizedCheckpoint.epoch;
      finalizedRoot = state.finalizedCheckpoint.root;
    }
    return {
      headForkVersion: this.chain.latestState.fork.currentVersion,
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
      !this.reps.get(peerInfo.id.toB58String()).latestStatus
    ) {
      const request = await this.createStatus();
      try {
        const response = await this.network.reqResp.status(peerInfo, request);
        this.reps.get(peerInfo.id.toB58String()).latestStatus = response;
      } catch (e) {
        this.logger.error(e);
      }
    }
  };
}
