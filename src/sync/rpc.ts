/**
 * @module sync
 */

import assert from "assert";
import BN from "bn.js";
import {hashTreeRoot} from "@chainsafe/ssz";
import {
  bytes32, Slot, number64,
  BeaconBlockHeader, BeaconBlockBody,
  RequestBody, Hello, Goodbye, Status,
  BeaconBlockRootsRequest, BeaconBlockRootsResponse,
  BeaconBlockHeadersRequest, BeaconBlockHeadersResponse,
  BeaconBlockBodiesRequest, BeaconBlockBodiesResponse,
  BeaconStatesRequest, BeaconStatesResponse,
} from "../types";
import {intDiv} from "../util/math";
import {IBeaconDb} from "../db";
import {BeaconChain} from "../chain";
import {INetwork, IPeer} from "../network";
import {Method, RequestId} from "../network/codec";
import {getEmptyBlockBody} from "../chain/genesis";
import {ZERO_HASH} from "../constants";

/**
 * The SyncRpc module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export class SyncRpc {
  private db: IBeaconDb;
  private chain: BeaconChain;
  private network: INetwork;
  public constructor(opts, {db, chain, network}) {
    this.db = db;
    this.chain = chain;
    this.network = network;
  }

  // create common requests

  public async createHello(): Promise<Hello> {
    let bestSlot, bestRoot, latestFinalizedEpoch, latestFinalizedRoot;
    if (!this.chain.genesisTime) {
      bestSlot = 0;
      bestRoot = ZERO_HASH;
      latestFinalizedEpoch = 0;
      latestFinalizedRoot = ZERO_HASH;
    } else {
      bestSlot = await this.db.getChainHeadSlot();
      bestRoot = await this.db.getBlockRoot(bestSlot);
      const state = await this.db.getState();
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
    const peer = this.network.getPeer(peerInfo);
    if (peer && !peer.latestHello) {
      await this.getHello(peer).catch((e) => {});
    }
  }

  public async refreshPeerHellos(): Promise<void> {
    await this.network.getPeers().map((peer) =>
      this.getHello(peer).catch((e) => {}));
  }

  public async getHello(peer: IPeer): Promise<Hello> {
    const hello = await this.createHello();
    const response = await peer.sendRequest<Hello>(Method.Hello, hello);
    peer.latestHello = response;
    return response;
  }

  public async getGoodbye(peer: IPeer): Promise<Goodbye> {
    return await peer.sendRequest<Goodbye>(Method.Goodbye, {reason: new BN(0)});
  }

  public async getStatus(peer: IPeer): Promise<Status> {
    const response = await peer.sendRequest<Status>(Method.Status, this.createStatus());
    peer.latestStatus = response;
    return response;
  }

  public async getBeaconBlockRoots(
    peer: IPeer,
    startSlot: Slot,
    count: number64
  ): Promise<BeaconBlockRootsResponse> {
    return await peer.sendRequest<BeaconBlockRootsResponse>(
      Method.BeaconBlockRoots, {startSlot, count});
  }

  public async getBeaconBlockHeaders(
    peer: IPeer,
    startRoot: bytes32,
    startSlot: Slot,
    maxHeaders: number64,
    skipSlots: number64
  ): Promise<BeaconBlockHeadersResponse> {
    return await peer.sendRequest<BeaconBlockHeadersResponse>(
      Method.BeaconBlockHeaders, {startRoot, startSlot, maxHeaders, skipSlots});
  }

  public async getBeaconBlockBodies(
    peer: IPeer,
    blockRoots: bytes32[]
  ): Promise<BeaconBlockBodiesResponse> {
    return await peer.sendRequest<BeaconBlockBodiesResponse>(
      Method.BeaconBlockBodies, {blockRoots});
  }

  public async getBeaconStates(
    peer: IPeer,
    hashes: bytes32[]
  ): Promise<BeaconStatesResponse> {
    return await peer.sendRequest<BeaconStatesResponse>(
      Method.BeaconStates, {hashes});
  }

  // handle incoming requests

  public async onRequest(
    method: Method,
    id: RequestId,
    body: RequestBody,
    peer: IPeer
  ): Promise<void> {
    switch (method) {
      case Method.Hello:
        return await this.onHello(id, body as Hello, peer);
      case Method.Goodbye:
        return await this.onGoodbye(id, body as Goodbye, peer);
      case Method.Status:
        return await this.onStatus(id, body as Status, peer);
      case Method.BeaconBlockRoots:
        return await this.onBeaconBlockRoots(id, body as BeaconBlockRootsRequest);
      case Method.BeaconBlockHeaders:
        return await this.onBeaconBlockHeaders(id, body as BeaconBlockHeadersRequest);
      case Method.BeaconBlockBodies:
        return await this.onBeaconBlockBodies(id, body as BeaconBlockBodiesRequest);
        return;
      case Method.BeaconStates:
        return await this.onBeaconStates(id, body as BeaconStatesRequest);
    }
  }

  public async onHello(id: RequestId, request: Hello, peer: IPeer): Promise<void> {
    // set hello on peer
    peer.latestHello = request;
    // send hello response
    try {
      const hello = await this.createHello();
      this.network.sendResponse(id, 0, hello);
    } catch (e) {
      this.network.sendResponse(id, 40, null);
    }
    // TODO handle incorrect networkId / chainId
  }

  public async onGoodbye(id: RequestId, request: Goodbye, peer: IPeer): Promise<void> {
    this.network.disconnect(peer);
  }

  public async onStatus(id: RequestId, request: Status, peer: IPeer): Promise<void> {
    peer.latestStatus = request;
    this.network.sendResponse(id, 40, this.createStatus());
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
    this.network.sendResponse(id, 0, response);
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
            previousBlockRoot: block.previousBlockRoot,
            stateRoot: block.stateRoot,
            blockBodyRoot: hashTreeRoot(block.body, BeaconBlockBody),
            signature: block.signature,
          };
          response.headers.push(header);
        } catch (e) {
        }
      }
      this.network.sendResponse(id, 0, response);
    } catch (e) {
      this.network.sendResponse(id, 40, null);
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
    this.network.sendResponse(id, 0, response);
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
