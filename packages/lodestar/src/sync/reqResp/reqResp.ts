/**
 * @module sync
 */

import PeerInfo from "peer-info";
import {
  BeaconBlocksByRangeRequest,
  BeaconBlocksByRootRequest,
  Epoch,
  Goodbye,
  Ping,
  RequestBody,
  Root,
  SignedBeaconBlock,
  Slot,
  Status,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Method, RequestId, ZERO_HASH} from "../../constants";
import {IBeaconDb} from "../../db";
import {IBeaconChain} from "../../chain";
import {INetwork} from "../../network";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IReqRespHandler} from "./interface";
import {BlockRepository} from "../../db/api/beacon/repositories";
import {IReputationStore} from "../IReputation";

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
        this.network.reqResp.goodbye(peerInfo, BigInt(GoodByeReasonCode.CLIENT_SHUTDOWN));
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
    return !this.config.types.ForkDigest.equals(currentForkDigest, request.forkDigest);

    //TODO: fix this, doesn't work if we are starting sync(archive is empty) or we don't have finalized epoch
    // const startSlot = computeStartSlotAtEpoch(this.config, request.finalizedEpoch);
    // const startBlock = await this.db.blockArchive.get(startSlot);
    // // we're on a further (or equal) finalized epoch
    // // but the peer's block root at that epoch doesn't match ours
    // if (
    //   state.finalizedCheckpoint.epoch >= request.finalizedEpoch &&
    //   !this.config.types.Root.equals(
    //     request.finalizedRoot,
    //     this.config.types.BeaconBlock.hashTreeRoot(startBlock.message)
    //   )
    // ) {
    //   return true;
    // }
    // return false;
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
      const archiveBlocksStream = this.db.blockArchive.getAllBetweenStream(
        request.startSlot - 1,
        request.startSlot + request.count,
        request.step
      );
      const responseStream = this.injectRecentBlocks(archiveBlocksStream, this.db.block, request);
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
      const getBlockArchive = this.db.blockArchive.get.bind(this.db.blockArchive);
      const blockGenerator = async function* () {
        for (const blockRoot of request) {
          const root = blockRoot.valueOf() as Uint8Array;
          const block = await getBlock(root) || await getBlockArchive(root);
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
      const state = await this.chain.getHeadState();
      headSlot = state.slot;
      headRoot = this.config.types.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader);
      finalizedEpoch = state.finalizedCheckpoint.epoch;
      finalizedRoot = state.finalizedCheckpoint.root;
    }
    return {
      forkDigest: this.chain.currentForkDigest,
      finalizedRoot,
      finalizedEpoch,
      headRoot,
      headSlot,
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
    blockDb: BlockRepository,
    request: BeaconBlocksByRangeRequest
  ): AsyncGenerator<SignedBeaconBlock> {
    let count = 0;
    for await(const archiveBlock of archiveStream) {
      count++;
      yield archiveBlock;
    }
    if(count < request.count) {
      for(
        let i = request.startSlot;
        i <= (request.startSlot + request.count) && count < request.count;
        i += request.step
      ) {
        const block = await blockDb.getBlockBySlot(i);
        if(block) {
          yield block;
        }
      }
    }
  };
}
