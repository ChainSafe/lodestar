/**
 * @module sync
 */

import assert from "assert";
import BN from "bn.js";
import {hashTreeRoot} from "@chainsafe/ssz";
import PeerInfo from "peer-info";

import {
  bytes32,
  Slot,
  number64,
  BeaconBlockHeader,
  RequestBody,
  Hello,
  Goodbye,
  Status,
  BeaconBlockHeadersRequest,
  BeaconBlockHeadersResponse,
  BeaconBlockBodiesResponse,
  BeaconStatesRequest,
  BeaconStatesResponse,
  Epoch,
  BeaconState,
  BeaconBlock,
  HobbitsGetBlockBodies,
  HobbitsGetAttestation, HobbitsAttestation, uint8, uint64, bytes,
} from "@chainsafe/eth2.0-types";
import {ZERO_HASH, ResponseCode, RequestId} from "../../constants";
import {intDiv} from "../../util/math";
import {IBeaconDb} from "../../db";
import {IBeaconChain} from "../../chain";
import {INetwork} from "../index";
import {ReputationStore} from "../../sync/reputation";
import {ILogger} from "../../logger";
import { IBeaconConfig } from "@chainsafe/eth2.0-config";
import {ISyncRpc} from "../../sync/rpc/interface";
import {Method} from "./constants";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface SyncOptions {
}

/**
 * The SyncRpc module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export class SyncRpc implements ISyncRpc {
  private opts: SyncOptions;
  private config: IBeaconConfig;
  private db: IBeaconDb;
  private chain: IBeaconChain;
  private network: INetwork;
  private reps: ReputationStore;
  private logger: ILogger;

  public constructor(opts: SyncOptions,
    {config, db, chain, network, reps, logger}:
    { config: IBeaconConfig; db: IBeaconDb; chain: IBeaconChain; network: INetwork; reps: ReputationStore; logger: ILogger }) {
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
    if (!this.chain.isInitialized()) {
      bestSlot = 0;
      bestRoot = ZERO_HASH;
      latestFinalizedEpoch = 0;
      latestFinalizedRoot = ZERO_HASH;
    } else {
      bestSlot = await this.db.chain.getChainHeadSlot();
      const [bRoot, state] = await Promise.all([
        this.db.chain.getBlockRoot(bestSlot),
        this.db.state.getLatest(),
      ]);
      bestRoot = bRoot;
      latestFinalizedEpoch = state.finalizedCheckpoint.epoch;
      latestFinalizedRoot = state.finalizedCheckpoint.root;
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
      await this.getHello(peerInfo).catch((e) => {
      });
    }
  }

  public async refreshPeerHellos(): Promise<void> {
    await this.network.getPeers().map((peerInfo) =>
      this.getHello(peerInfo).catch((e) => {
      }));
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
    const response = await this.network.sendRequest<Status>(peerInfo, Method.GetStatus, this.createStatus());
    this.reps.get(peerInfo.id.toB58String()).latestStatus = response;
    return response;
  }

  /*public async getBeaconBlockRoots(
    peerInfo: PeerInfo,
    startSlot: Slot,
    count: number64
  ): Promise<BeaconBlockRootsResponse> {
    return await this.network.sendRequest<BeaconBlockRootsResponse>(
      peerInfo, Method.BeaconBlockRoots, {startSlot, count});
  }*/

  public async getBeaconBlockHeaders(
    peerInfo: PeerInfo,
    startRoot: bytes32,
    startSlot: Slot,
    max: number64,
    skip: number,
    direction: boolean
  ): Promise<BeaconBlockHeadersResponse> {
    return await this.network.sendRequest<BeaconBlockHeadersResponse>(
      peerInfo, Method.GetBlockHeaders, {
        startRoot,
        startSlot,
        max: new BN(max),
        skip: new BN(skip),
        direction: (direction? 1:0)
      });
  }

  public async getBeaconBlockBodies(
    peerInfo: PeerInfo,
    startRoot: bytes32,
    startSlot: Slot,
    max: number64,
    skip: number,
    direction: boolean
  ): Promise<BeaconBlockBodiesResponse> {
    return await this.network.sendRequest<BeaconBlockBodiesResponse>(
      peerInfo, Method.GetBlockHeaders, {
        startRoot,
        startSlot,
        max: new BN(max),
        skip: new BN(skip),
        direction: (direction? 1:0)
      });
  }

  public async getAttestation(
    peerInfo: PeerInfo,
    hash: bytes
  ): Promise<HobbitsAttestation> {
    return await this.network.sendRequest<HobbitsAttestation>(
      peerInfo, Method.GetAttestation, {hash});
  }

  public async getBeaconStates(
    peerInfo: PeerInfo,
    hashes: bytes32[]
  ): Promise<BeaconState[]> {
    const stateResponse = await this.network.sendRequest<BeaconStatesResponse>(
      peerInfo, Method.BeaconStates, {hashes});
    return stateResponse.states;
  }

  // handle incoming requests

  public async onRequest(
    peerInfo: PeerInfo,
    method: number,
    id: RequestId,
    body: RequestBody,
  ): Promise<void> {
    switch (method) {
      case Method.Hello:
        return await this.onHello(peerInfo, id, body as Hello);
      case Method.Goodbye:
        return await this.onGoodbye(peerInfo, id, body as Goodbye);
      case Method.GetStatus:
        return await this.onStatus(peerInfo, id, body as Status);
      // case Method.BeaconBlockRoots:
      //   return await this.onBeaconBlockRoots(id, body as BeaconBlockRootsRequest);
      case Method.GetBlockHeaders:
        return await this.onBeaconBlockHeaders(id, body as BeaconBlockHeadersRequest);
      case Method.GetBlockBodies:
        return await this.onBeaconBlockBodies(id, body as HobbitsGetBlockBodies);
      case Method.GetAttestation:
        return await this.onGetAttestation(id, body as HobbitsGetAttestation);
      case Method.GetBeaconStates:
        return await this.onBeaconStates(id, body as BeaconStatesRequest);
      default:
        this.logger.error(`Hobbits :: Invalid request method ${method} from ${peerInfo.id.toB58String()}`);
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

  /*public async onBeaconBlockRoots(id: RequestId, request: BeaconBlockRootsRequest): Promise<void> {
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
  }*/

  public async onBeaconBlockHeaders(
    id: RequestId,
    request: BeaconBlockHeadersRequest
  ): Promise<void> {
    try {
      const response: BeaconBlockHeadersResponse = {
        headers: [],
      };
      const blockRoot = await this.db.chain.getBlockRoot(request.startSlot);
      assert(blockRoot.equals(request.startRoot));
      for (
        let slot = request.startSlot;
        slot < request.startSlot + request.maxHeaders;
        slot += request.skipSlots
      ) {
        try {
          const block = await this.db.block.getBlockBySlot(slot);
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
      if(!request.direction){
        response.headers.reverse();
      }
      this.network.sendResponse(id, ResponseCode.Success, response);
    } catch (e) {
      // this.network.sendResponse(id, ResponseCode.ServerError, null);
    }
  }

  public async onBeaconBlockBodies(
    id: RequestId,
    request: HobbitsGetBlockBodies
  ): Promise<void> {
    try {
      const response: BeaconBlockBodiesResponse = {
        bodies: [],
      };
      const blockRoot = await this.db.chain.getBlockRoot(request.startSlot);
      assert(blockRoot.equals(request.startRoot));
      for (
        let slot = new BN(request.startSlot);
        slot <  request.max.add(new BN(request.startSlot));
        slot = slot.add(request.skip)
      ) {
        try {
          const block = await this.db.block.getBlockBySlot(slot.toNumber());
          response.bodies.push(block.body);
        } catch (e) {
        }
      }
      if(!request.direction){
        response.bodies.reverse();
      }
      this.network.sendResponse(id, ResponseCode.Success, response);
    } catch (e) {
      // this.network.sendResponse(id, ResponseCode.ServerError, null);
    }
  }

  public async onGetAttestation(
    id: RequestId,
    request: HobbitsGetAttestation
  ): Promise<void> {
    const response: HobbitsAttestation = {
      attestation: await this.db.attestation.get(request.hash),
    };

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
    this.network.getPeers().map((p) => this.getGoodbye(p).catch((e) => {
    }));
  }

  public async getBeaconBlocks(
    peerInfo: PeerInfo, startRoot: bytes32, startSlot: Slot, count: number64, backward: boolean
  ): Promise<BeaconBlock[]> {
    const [
      blockHeadersResponse,
      blockBodiesResponse
    ]: [BeaconBlockHeadersResponse, BeaconBlockBodiesResponse] = await Promise.all([
      this.getBeaconBlockHeaders(peerInfo, startRoot, startSlot, count, 0, backward),
      this.getBeaconBlockBodies(peerInfo, startRoot, startSlot, count, 0, backward),
    ]);
    assert(blockHeadersResponse.headers.length === blockBodiesResponse.blockBodies.length);
    const blocks = blockHeadersResponse.headers.map((header, index) => {
      delete header.bodyRoot;
      const body = blockBodiesResponse.blockBodies[index];
      const block: BeaconBlock = {
        ...header,
        body,
      };
      return block;
    });

    return blocks;
  }
}
