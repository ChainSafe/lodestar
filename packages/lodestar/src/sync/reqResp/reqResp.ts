/**
 * @module sync
 */

import PeerId from "peer-id";
import {
  BeaconBlocksByRangeRequest,
  BeaconBlocksByRootRequest,
  Goodbye,
  Ping,
  RequestBody,
  SignedBeaconBlock,
  Status,
  MAX_REQUEST_BLOCKS,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {GENESIS_EPOCH, Method, RequestId, RpcResponseStatus, ZERO_HASH} from "../../constants";
import {IBeaconDb} from "../../db";
import {IBeaconChain} from "../../chain";
import {INetwork} from "../../network";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IReqRespHandler} from "./interface";
import {IReputationStore} from "../IReputation";
import {computeStartSlotAtEpoch, getBlockRoot, GENESIS_SLOT} from "@chainsafe/lodestar-beacon-state-transition";
import {toHexString} from "@chainsafe/ssz";
import {RpcError} from "../../network/error";

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
      this.network.getPeers().map((peerId) =>
        this.network.reqResp.status(peerId, myStatus)));

  }

  public async stop(): Promise<void> {
    this.network.removeListener("peer:connect", this.handshake);
    this.network.reqResp.removeListener("request", this.onRequest);
    await Promise.all(
      this.network.getPeers().map((peerId) => {
        return this.network.reqResp.goodbye(peerId, BigInt(GoodByeReasonCode.CLIENT_SHUTDOWN));
      }));
  }

  public onRequest = async (
    peerId: PeerId,
    method: Method,
    id: RequestId,
    body?: RequestBody,
  ): Promise<void> => {
    switch (method) {
      case Method.Status:
        return await this.onStatus(peerId, id, body as Status);
      case Method.Goodbye:
        return await this.onGoodbye(peerId, id, body as Goodbye);
      case Method.Ping:
        return await this.onPing(peerId, id, body as Ping);
      case Method.Metadata:
        return await this.onMetadata(peerId, id);
      case Method.BeaconBlocksByRange:
        return await this.onBeaconBlocksByRange(id, body as BeaconBlocksByRangeRequest);
      case Method.BeaconBlocksByRoot:
        return await this.onBeaconBlocksByRoot(id, body as BeaconBlocksByRootRequest);
      default:
        this.logger.error(`Invalid request method ${method} from ${peerId.toB58String()}`);
    }
  };

  public async onStatus(peerId: PeerId, id: RequestId, request: Status): Promise<void> {
    if (await this.shouldDisconnectOnStatus(request)) {
      await this.network.reqResp.goodbye(peerId, BigInt(GoodByeReasonCode.IRRELEVANT_NETWORK));
    }
    // set status on peer
    this.reps.get(peerId.toB58String()).latestStatus = request;
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
          + `expected=${toHexString(currentForkDigest)} received=${toHexString(request.forkDigest)}`
      );
      return true;
    }

    if (request.finalizedEpoch === GENESIS_EPOCH) {
      if (!this.config.types.Root.equals(request.finalizedRoot, ZERO_HASH)) {
        this.logger.warn("Genesis finalized root must be zeroed "
          + `expected=${toHexString(ZERO_HASH)} received=${toHexString(request.finalizedRoot)}`
        );
        return true;
      }
    } else {
      // we're on a further (or equal) finalized epoch
      // but the peer's block root at that epoch may not match match ours
      const headSummary = this.chain.forkChoice.head();
      const finalizedCheckpoint = headSummary.finalizedCheckpoint;
      const requestFinalizedSlot = computeStartSlotAtEpoch(this.config, request.finalizedEpoch);

      if (request.finalizedEpoch === finalizedCheckpoint.epoch) {
        if (!this.config.types.Root.equals(request.finalizedRoot, finalizedCheckpoint.root)) {
          this.logger.warn("Status with same finalized epoch has different root "
            + `expected=${toHexString(finalizedCheckpoint.root)} received=${toHexString(request.finalizedRoot)}`
          );
          return true;
        }
      } else if (request.finalizedEpoch < finalizedCheckpoint.epoch) {
        // If it is within recent history, we can directly check against the block roots in the state
        if((headSummary.slot - requestFinalizedSlot) < this.config.params.HISTORICAL_ROOTS_LIMIT) {
          const headState = await this.chain.getHeadState();
          // This will get the latest known block at the start of the epoch.
          const expected = getBlockRoot(this.config, headState, request.finalizedEpoch);
          if (!this.config.types.Root.equals(request.finalizedRoot, expected)) {
            return true;
          }
        } else {
          // finalized checkpoint of status is from an old long-ago epoch.
          // We need to ask the chain for most recent canonical block at the finalized checkpoint start slot.
          // The problem is that the slot may be a skip slot.
          // And the block root may be from multiple epochs back even.
          // The epoch in the checkpoint is there to checkpoint the tail end of skip slots, even if there is no block.

          // TODO: accepted for now. Need to maintain either a list of finalized block roots,
          // or inefficiently loop from finalized slot backwards, until we find the block we need to check against.
        }
      } else {
        // request status finalized checkpoint is in the future, we do not know if it is a true finalized root
        this.logger.verbose("Status with future finalized epoch " +
          `${request.finalizedEpoch}: ${toHexString(request.finalizedRoot)}`);
      }
    }
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async onGoodbye(peerId: PeerId, id: RequestId, request: Goodbye): Promise<void> {
    this.logger.info(`Received goodbye request from ${peerId.toB58String()}, reason=${request}`);
    this.network.reqResp.sendResponse(id, null, BigInt(GoodByeReasonCode.CLIENT_SHUTDOWN));
    // //  TODO: fix once we can check if response is sent
    const disconnect = this.network.disconnect.bind(this.network);
    setTimeout(async () => {
      try {
        await disconnect(peerId);
      } catch (e) {
        //ignored probably peer disconnected already
      }
    }, 400);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async onPing(peerId: PeerId, id: RequestId, request: Ping): Promise<void> {
    this.network.reqResp.sendResponse(id, null, this.network.metadata.seqNumber);
    // TODO handle peer sequence number update
  }

  public async onMetadata(peerId: PeerId, id: RequestId): Promise<void> {
    this.network.reqResp.sendResponse(id, null, this.network.metadata.metadata);
  }

  public async onBeaconBlocksByRange(
    id: RequestId,
    request: BeaconBlocksByRangeRequest
  ): Promise<void> {
    if (request.step < 1 || request.startSlot < GENESIS_SLOT || request.count < 1) {
      this.logger.error(`Invalid request id ${id} start: ${request.startSlot} step: ${request.step}` +
      ` count: ${request.count}`);
      this.network.reqResp.sendResponse(
        id,
        new RpcError(RpcResponseStatus.ERR_INVALID_REQ, "Invalid request"),
        null);
      return;
    }
    if (request.count > 1000) {
      this.logger.warn(`Request id ${id} asked for ${request.count} blocks, just return 1000 maximum`);
      request.count = 1000;
    }
    try {
      if (request.count > MAX_REQUEST_BLOCKS) {
        this.logger.warn(`Request id ${id} asked for ${request.count} blocks, ` +
          `just return ${MAX_REQUEST_BLOCKS} maximum`);
        request.count = MAX_REQUEST_BLOCKS;
      }
      const archiveBlocksStream = this.db.blockArchive.valuesStream({
        gte: request.startSlot,
        lt: request.startSlot + request.count * request.step,
        step: request.step,
      });
      const responseStream = this.injectRecentBlocks(this.config, archiveBlocksStream, this.chain, request);
      this.network.reqResp.sendResponseStream(id, null, responseStream);
    } catch (e) {
      this.logger.error(`Error processing request id ${id}: ${e.message}`);
      this.network.reqResp.sendResponse(id, new RpcError(RpcResponseStatus.SERVER_ERROR, e.message), null);
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
      finalizedRoot: head.finalizedCheckpoint.epoch === GENESIS_EPOCH ? ZERO_HASH : head.finalizedCheckpoint.root,
      finalizedEpoch: head.finalizedCheckpoint.epoch,
      headRoot: head.blockRoot,
      headSlot: head.slot,
    };
  }

  private handshake = async (peerId: PeerId, direction: "inbound"|"outbound"): Promise<void> => {
    if(direction === "outbound") {
      const request = await this.createStatus();
      try {
        this.reps.get(peerId.toB58String()).latestStatus = await this.network.reqResp.status(peerId, request);
      } catch (e) {
        this.logger.error(`Failed to get peer ${peerId.toB58String()} latest status. Error: ` + e.message);
      }
    }
  };

  private injectRecentBlocks = async function* (
    config: IBeaconConfig,
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
    const slots = [];
    while (slot < upperSlot) {
      slots.push(slot);
      slot += request.step;
    }
    const blocks = await chain.getUnfinalizedBlocksAtSlots(slots) || [];
    for (const block of blocks) {
      if(block) {
        yield block;
      }
    }
  };
}


