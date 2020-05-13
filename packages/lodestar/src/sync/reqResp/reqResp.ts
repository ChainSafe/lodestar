/**
 * @module sync
 */

import PeerInfo from "peer-info";
import {
  BeaconBlocksByRangeRequest,
  BeaconBlocksByRootRequest,
  Goodbye,
  Ping,
  RequestBody,
  SignedBeaconBlock,
  Status,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {GENESIS_EPOCH, Method, RequestId} from "../../constants";
import {IBeaconDb} from "../../db";
import {IBeaconChain} from "../../chain";
import {INetwork} from "../../network";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IReqRespHandler} from "./interface";
import {IReputationStore} from "../IReputation";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {toHexString} from "@chainsafe/ssz";

export interface IReqRespHandlerModules {
  config: IBeaconConfig;
  db: IBeaconDb;
  chain: IBeaconChain;
  network: INetwork;
  reputationStore: IReputationStore;
  logger: ILogger;
}

enum GoodByeReasonCode {
  CLIENT_SHUTDOWN = 1,
  IRRELEVANT_NETWORK = 2,
  ERROR = 3,
}

/**
 * The BeaconReqRespHandler module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export class BeaconReqRespHandler implements IReqRespHandler {
  private config: IBeaconConfig;
  private db: IBeaconDb;
  private chain: IBeaconChain;
  private network: INetwork;
  private reps: IReputationStore;
  private logger: ILogger;

  public constructor({config, db, chain, network, reputationStore, logger}: IReqRespHandlerModules) {
    this.config = config;
    this.db = db;
    this.chain = chain;
    this.network = network;
    this.reps = reputationStore;
    this.logger = logger;
  }

  public async start(): Promise<void> {
    this.network.reqResp.on("request", this.onRequest);
    this.network.on("peer:connect", this.handshake);
    const myStatus = await this.createStatus();
    await Promise.all(
      this.network.getPeers().map((peerInfo) =>
        this.network.reqResp.status(peerInfo, myStatus)));
  }

  public async stop(): Promise<void> {
    this.network.removeListener("peer:connect", this.handshake);
    this.network.reqResp.removeListener("request", this.onRequest);
    await Promise.all(
      this.network.getPeers().map((peerInfo) => {
        return this.network.reqResp.goodbye(peerInfo, BigInt(GoodByeReasonCode.CLIENT_SHUTDOWN));
      }));
  }

  public onRequest = async (
    peerInfo: PeerInfo,
    method: Method,
    id: RequestId,
    body?: RequestBody,
  ): Promise<void> => {
    switch (method) {
      case Method.Status:
        return await this.onStatus(peerInfo, id, body as Status);
      case Method.Goodbye:
        return await this.onGoodbye(peerInfo, id, body as Goodbye);
      case Method.Ping:
        return await this.onPing(peerInfo, id, body as Ping);
      case Method.Metadata:
        return await this.onMetadata(peerInfo, id);
      case Method.BeaconBlocksByRange:
        return await this.onBeaconBlocksByRange(id, body as BeaconBlocksByRangeRequest);
      case Method.BeaconBlocksByRoot:
        return await this.onBeaconBlocksByRoot(id, body as BeaconBlocksByRootRequest);
      default:
        this.logger.error(`Invalid request method ${method} from ${peerInfo.id.toB58String()}`);
    }
  };

  public async onStatus(peerInfo: PeerInfo, id: RequestId, request: Status): Promise<void> {
    if (await this.shouldDisconnectOnStatus(request)) {
      await this.network.reqResp.goodbye(peerInfo, BigInt(GoodByeReasonCode.IRRELEVANT_NETWORK));
    }
    // set status on peer
    this.reps.get(peerInfo.id.toB58String()).latestStatus = request;
    // send status response
    try {
      const status = await this.createStatus();
      this.network.reqResp.sendResponse(id, null, status);
    } catch (e) {
      this.logger.error("Failed to create response status", e.message);
      this.network.reqResp.sendResponse(id, e, null);
    }
  }

  public async shouldDisconnectOnStatus(request: Status): Promise<boolean> {
    const currentForkDigest = this.chain.currentForkDigest;
    if(!this.config.types.ForkDigest.equals(currentForkDigest, request.forkDigest)) {
      this.logger.warn("Fork digest mismatch "
          + `expected=${toHexString(currentForkDigest)} received ${toHexString(request.forkDigest)}`
      );
      return true;
    }

    const startSlot = computeStartSlotAtEpoch(this.config, request.finalizedEpoch);
    const finalizedCheckpoint = this.chain.forkChoice.getFinalized();
    // we're on a further (or equal) finalized epoch
    // but the peer's block root at that epoch doesn't match ours
    if (finalizedCheckpoint.epoch >= request.finalizedEpoch && request.finalizedEpoch !== GENESIS_EPOCH) {
      const startBlock = await this.chain.getBlockAtSlot(startSlot);
      const result = !this.config.types.Root.equals(
        request.finalizedRoot,
        this.config.types.BeaconBlock.hashTreeRoot(startBlock.message));
      if(result) {
        this.logger.warn("Finalized root mismatch "
            + `expected=${toHexString(currentForkDigest)} received ${toHexString(request.forkDigest)}`
        );
        return result;
      }
    }
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async onGoodbye(peerInfo: PeerInfo, id: RequestId, request: Goodbye): Promise<void> {
    this.network.reqResp.sendResponse(id, null, BigInt(GoodByeReasonCode.CLIENT_SHUTDOWN));
    // //  TODO: fix once we can check if response is sent
    const disconnect = this.network.disconnect.bind(this.network);
    setTimeout(async () => {
      try {
        await disconnect(peerInfo);
      } catch (e) {
        //ignored probably peer disconnected already
      }
    }, 400);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async onPing(peerInfo: PeerInfo, id: RequestId, request: Ping): Promise<void> {
    this.network.reqResp.sendResponse(id, null, this.network.metadata.seqNumber);
    // TODO handle peer sequence number update
  }

  public async onMetadata(peerInfo: PeerInfo, id: RequestId): Promise<void> {
    this.network.reqResp.sendResponse(id, null, this.network.metadata.metadata);
  }

  public async onBeaconBlocksByRange(
    id: RequestId,
    request: BeaconBlocksByRangeRequest
  ): Promise<void> {
    try {
      const archiveBlocksStream = this.db.blockArchive.valuesStream({
        gte: request.startSlot,
        lt: request.startSlot + request.count * request.step,
        step: request.step,
      });
      const responseStream = this.injectRecentBlocks(archiveBlocksStream, this.chain, request);
      this.network.reqResp.sendResponseStream(id, null, responseStream);
    } catch (e) {
      this.network.reqResp.sendResponse(id, e, null);
    }
  }

  public async onBeaconBlocksByRoot(
    id: RequestId,
    request: BeaconBlocksByRootRequest
  ): Promise<void> {
    try {
      const getBlock = this.db.block.get.bind(this.db.block);
      const blockGenerator = async function* () {
        for (const blockRoot of request) {
          const root = blockRoot.valueOf() as Uint8Array;
          const block = await getBlock(root);
          if (block) {
            yield block;
          }
        }
      }();
      this.network.reqResp.sendResponseStream(id, null, blockGenerator);
    } catch (e) {
      this.network.reqResp.sendResponse(id, e, null);
    }
  }

  private async createStatus(): Promise<Status> {
    const head = this.chain.forkChoice.head();
    return {
      forkDigest: this.chain.currentForkDigest,
      finalizedRoot: head.finalizedCheckpoint.root,
      finalizedEpoch: head.finalizedCheckpoint.epoch,
      headRoot: head.blockRoot,
      headSlot: head.slot,
    };
  }

  private handshake = async (peerInfo: PeerInfo, direction: "inbound"|"outbound"): Promise<void> => {
    if(direction === "outbound") {
      const request = await this.createStatus();
      try {
        this.reps.get(peerInfo.id.toB58String()).latestStatus = await this.network.reqResp.status(peerInfo, request);
      } catch (e) {
        this.logger.error(e);
      }
    }
  };

  private injectRecentBlocks = async function* (
    archiveStream: AsyncIterable<SignedBeaconBlock>,
    chain: IBeaconChain,
    request: BeaconBlocksByRangeRequest
  ): AsyncGenerator<SignedBeaconBlock> {
    let slot = -1;
    for await(const archiveBlock of archiveStream) {
      yield archiveBlock;
      slot = archiveBlock.message.slot;
    }
    slot = (slot === -1)? request.startSlot : slot + request.step;
    const upperSlot = request.startSlot + request.count * request.step;
    while (slot < upperSlot) {
      const block = await chain.getBlockAtSlot(slot);
      if(block) {
        yield block;
      }
      slot += request.step;
    }
  };
}
