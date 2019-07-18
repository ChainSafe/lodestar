/**
 * @module sync
 */

import assert from "assert";
import BN from "bn.js";
import {hashTreeRoot} from "@chainsafe/ssz";
import PeerInfo from "peer-info";

import {
  bytes32, Slot, number64,
  BeaconBlockHeader, BeaconBlockBody,
  RequestBody, Hello, Goodbye, Status,
  BeaconBlockRootsRequest, BeaconBlockRootsResponse,
  BeaconBlockHeadersRequest, BeaconBlockHeadersResponse,
  BeaconBlockBodiesRequest, BeaconBlockBodiesResponse,
  BeaconStatesRequest, BeaconStatesResponse, Epoch,
} from "../types";
import {ZERO_HASH, Method, RequestId, ResponseCode} from "../constants";
import {intDiv} from "../util/math";
import {IBeaconDb} from "../db";
import {IBeaconChain} from "../chain";
import {INetwork} from "../network";
import {getEmptyBlockBody} from "../chain/genesis";
import {ReputationStore} from "./reputation";
import {ILogger} from "../logger";
import { IBeaconConfig } from "../config";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface SyncOptions {
}

/**
 * The SyncRpc module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export class SyncRpc {
  private opts: SyncOptions;
  private config: IBeaconConfig;
  private db: IBeaconDb;
  private chain: IBeaconChain;
  private network: INetwork;
  private reps: ReputationStore;
  private logger: ILogger;

  public constructor(opts: SyncOptions,
    {config, db, chain, network, reps, logger}:
    {config: IBeaconConfig; db: IBeaconDb; chain: IBeaconChain; network: INetwork; reps: ReputationStore; logger: ILogger} )
  {
    this.config = config;
    this.logger = logger;
    this.opts = opts;
    this.db = db;
    this.chain = chain;
    this.network = network;
    this.reps = reps;
  }

  // create common requests

  public async createHello(): Promise<Hello> {
    let bestSlot: Slot,
      bestRoot: bytes32,
      latestFinalizedEpoch: Epoch,
      latestFinalizedRoot: bytes32;
    if (!this.chain.genesisTime) {
      bestSlot = 0;
      bestRoot = ZERO_HASH;
      latestFinalizedEpoch = 0;
      latestFinalizedRoot = ZERO_HASH;
    } else {
      bestSlot = await this.db.getChainHeadSlot();
      const [bRoot, state] = await Promise.all([
        this.db.getBlockRoot(bestSlot),
        this.db.getLatestState(),
      ]);
      bestRoot = bRoot;
      latestFinalizedEpoch = state.finalizedEpoch;
      latestFinalizedRoot = state.finalizedRoot;
    }
    return {
      networkId: this.chain.networkId,
      chainId: this.chain.chainId,
      latestFinalizedRoot,
      latestFinalizedEpoch,
      bestRoot,
      bestSlot,
    };
  }

  public createStatus(): Status {
    return {
      sha: Buffer.alloc(32),
      userAgent: Buffer.from("Lodestar"),
      timestamp: intDiv(Date.now(), 1000),
    };
  }

  // send outgoing requests

  private async handshake(peerInfo: PeerInfo): Promise<void> {
    const randomDelay = Math.floor(Math.random() * 5000);
    await new Promise((resolve) => setTimeout(resolve, randomDelay));
    if (
      this.network.hasPeer(peerInfo) &&
      !this.reps.get(peerInfo.id.toB58String()).latestHello
    ) {
      await this.getHello(peerInfo).catch((e) => {});
    }
  }

  public async refreshPeerHellos(): Promise<void> {
    await this.network.getPeers().map((peerInfo) =>
      this.getHello(peerInfo).catch((e) => {}));
  }

  public async getHello(peerInfo: PeerInfo): Promise<Hello> {
    const hello = await this.createHello();
    const response = await this.network.sendRequest<Hello>(peerInfo, Method.Hello, hello);
    this.reps.get(peerInfo.id.toB58String()).latestHello = response;
    return response;
  }

  public async getGoodbye(peerInfo: PeerInfo): Promise<Goodbye> {
    return await this.network.sendRequest<Goodbye>(peerInfo, Method.Goodbye, {reason: new BN(0)});
  }

  public async getStatus(peerInfo: PeerInfo): Promise<Status> {
    const response = await this.network.sendRequest<Status>(peerInfo, Method.Status, this.createStatus());
    this.reps.get(peerInfo.id.toB58String()).latestStatus = response;
    return response;
  }

  public async getBeaconBlockRoots(
    peerInfo: PeerInfo,
    startSlot: Slot,
    count: number64
  ): Promise<BeaconBlockRootsResponse> {
    return await this.network.sendRequest<BeaconBlockRootsResponse>(
      peerInfo, Method.BeaconBlockRoots, {startSlot, count});
  }

  public async getBeaconBlockHeaders(
    peerInfo: PeerInfo,
    startRoot: bytes32,
    startSlot: Slot,
    maxHeaders: number64,
    skipSlots: number64
  ): Promise<BeaconBlockHeadersResponse> {
    return await this.network.sendRequest<BeaconBlockHeadersResponse>(
      peerInfo, Method.BeaconBlockHeaders, {startRoot, startSlot, maxHeaders, skipSlots});
  }

  public async getBeaconBlockBodies(
    peerInfo: PeerInfo,
    blockRoots: bytes32[]
  ): Promise<BeaconBlockBodiesResponse> {
    return await this.network.sendRequest<BeaconBlockBodiesResponse>(
      peerInfo, Method.BeaconBlockBodies, {blockRoots});
  }

  public async getBeaconStates(
    peerInfo: PeerInfo,
    hashes: bytes32[]
  ): Promise<BeaconStatesResponse> {
    return await this.network.sendRequest<BeaconStatesResponse>(
      peerInfo, Method.BeaconStates, {hashes});
  }

  // handle incoming requests

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
      case Method.Status:
        return await this.onStatus(peerInfo, id, body as Status);
      case Method.BeaconBlockRoots:
        return await this.onBeaconBlockRoots(id, body as BeaconBlockRootsRequest);
      case Method.BeaconBlockHeaders:
        return await this.onBeaconBlockHeaders(id, body as BeaconBlockHeadersRequest);
      case Method.BeaconBlockBodies:
        return await this.onBeaconBlockBodies(id, body as BeaconBlockBodiesRequest);
      case Method.BeaconStates:
        return await this.onBeaconStates(id, body as BeaconStatesRequest);
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
      this.network.sendResponse(id, ResponseCode.Success, hello);
    } catch (e) {
      this.network.sendResponse(id, ResponseCode.ServerError, null);
    }
    // TODO handle incorrect networkId / chainId
  }

  public async onGoodbye(peerInfo: PeerInfo, id: RequestId, request: Goodbye): Promise<void> {
    this.network.disconnect(peerInfo);
  }

  public async onStatus(peerInfo: PeerInfo, id: RequestId, request: Status): Promise<void> {
    this.reps.get(peerInfo.id.toB58String()).latestStatus = request;
    this.network.sendResponse(id, ResponseCode.Success, this.createStatus());
  }

  public async onBeaconBlockRoots(id: RequestId, request: BeaconBlockRootsRequest): Promise<void> {
    const response: BeaconBlockRootsResponse = {
      roots: [],
    };
    for (let slot = request.startSlot; slot < request.startSlot + request.count; slot++) {
      try {
        const blockRoot = await this.db.getBlockRoot(slot);
        response.roots.push({
          slot,
          blockRoot,
        });
      } catch (e) {
      }
    }
    // send a response even if fewer block roots get sent
    this.network.sendResponse(id, ResponseCode.Success, response);
  }

  public async onBeaconBlockHeaders(
    id: RequestId,
    request: BeaconBlockHeadersRequest
  ): Promise<void> {
    try {
      const response: BeaconBlockHeadersResponse = {
        headers: [],
      };
      const blockRoot = await this.db.getBlockRoot(request.startSlot);
      assert(blockRoot.equals(request.startRoot));
      for (
        let slot = request.startSlot;
        slot < request.startSlot + request.maxHeaders;
        slot += request.skipSlots
      ) {
        try {
          const block = await this.db.getBlockBySlot(slot);
          const header: BeaconBlockHeader = {
            slot: block.slot,
            parentRoot: block.parentRoot,
            stateRoot: block.stateRoot,
            bodyRoot: hashTreeRoot(block.body, this.config.types.BeaconBlockBody),
            signature: block.signature,
          };
          response.headers.push(header);
        } catch (e) {
        }
      }
      this.network.sendResponse(id, ResponseCode.Success, response);
    } catch (e) {
      this.network.sendResponse(id, ResponseCode.ServerError, null);
    }
  }

  public async onBeaconBlockBodies(
    id: RequestId,
    request: BeaconBlockBodiesRequest
  ): Promise<void> {
    const response: BeaconBlockBodiesResponse = {
      blockBodies: [],
    };
    for (const root of request.blockRoots) {
      try {
        const block = await this.db.getBlock(root);
        response.blockBodies.push(block.body);
      } catch (e) {
        response.blockBodies.push(getEmptyBlockBody());
      }
    }
    this.network.sendResponse(id, ResponseCode.Success, response);
  }

  public async onBeaconStates(
    id: RequestId,
    request: BeaconStatesRequest
  ): Promise<void> {
  }

  // service

  public async start(): Promise<void> {
    this.network.on("peer:connect", this.handshake.bind(this));
  }

  public async stop(): Promise<void> {
    this.network.removeListener("peer:connect", this.handshake.bind(this));
    this.network.getPeers().map((p) => this.getGoodbye(p).catch((e) => {}));
  }
}
