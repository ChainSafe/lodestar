/**
 * @module sync
 */

import {GENESIS_SLOT} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {MAX_REQUEST_BLOCKS, phase0} from "@chainsafe/lodestar-types";
import {ILogger, LodestarError} from "@chainsafe/lodestar-utils";
import PeerId from "peer-id";
import {IBeaconChain} from "../../chain";
import {Method, ReqRespEncoding, RpcResponseStatus} from "../../constants";
import {IBeaconDb} from "../../db";
import {IBlockFilterOptions} from "../../db/api/beacon/repositories";
import {createRpcProtocol, INetwork, NetworkEvent} from "../../network";
import {ResponseError} from "../../network/reqresp/response";
import {handlePeerMetadataSequence} from "../../network/peers/utils";
import {syncPeersStatus} from "../utils/sync";
import {assertPeerRelevance} from "../utils/assertPeerRelevance";
import {IReqRespHandler} from "./interface";

export interface IReqRespHandlerModules {
  config: IBeaconConfig;
  db: IBeaconDb;
  chain: IBeaconChain;
  network: INetwork;
  logger: ILogger;
}

enum GoodByeReasonCode {
  CLIENT_SHUTDOWN = 1,
  IRRELEVANT_NETWORK = 2,
  ERROR = 3,
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const GoodbyeReasonCodeDescriptions: Record<string, string> = {
  // spec-defined codes
  1: "Client shutdown",
  2: "Irrelevant network",
  3: "Internal fault/error",

  // Teku-defined codes
  128: "Unable to verify network",

  // Lighthouse-defined codes
  129: "Client has too many peers",
  250: "Peer score too low",
  251: "Peer banned this node",
};

/**
 * The BeaconReqRespHandler module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export class BeaconReqRespHandler implements IReqRespHandler {
  private config: IBeaconConfig;
  private db: IBeaconDb;
  private chain: IBeaconChain;
  private network: INetwork;
  private logger: ILogger;

  public constructor({config, db, chain, network, logger}: IReqRespHandlerModules) {
    this.config = config;
    this.db = db;
    this.chain = chain;
    this.network = network;
    this.logger = logger;
  }

  public async start(): Promise<void> {
    this.network.reqResp.registerHandler(this.onRequest.bind(this));
    this.network.on(NetworkEvent.peerConnect, this.handshake);
    const myStatus = this.chain.getStatus();
    await syncPeersStatus(this.network, myStatus);
  }

  public async stop(): Promise<void> {
    this.network.off(NetworkEvent.peerConnect, this.handshake);
    await Promise.all(
      this.network
        .getPeers({supportsProtocols: [createRpcProtocol(Method.Goodbye, ReqRespEncoding.SSZ_SNAPPY)]})
        .map(async (peer) => {
          try {
            await this.network.reqResp.goodbye(peer.id, BigInt(GoodByeReasonCode.CLIENT_SHUTDOWN));
          } catch (e) {
            this.logger.verbose("Failed to send goodbye", {error: e.message});
          }
        })
    );
    this.network.reqResp.unregisterHandler();
  }

  public async *onRequest(
    method: Method,
    requestBody: phase0.RequestBody,
    peerId: PeerId
  ): AsyncIterable<phase0.ResponseBody> {
    switch (method) {
      case Method.Status:
        yield* this.onStatus(requestBody as phase0.Status, peerId);
        break;
      case Method.Goodbye:
        yield* this.onGoodbye(requestBody as phase0.Goodbye, peerId);
        break;
      case Method.Ping:
        yield* this.onPing(requestBody as phase0.Ping, peerId);
        break;
      case Method.Metadata:
        yield* this.onMetadata();
        break;
      case Method.BeaconBlocksByRange:
        yield* this.onBeaconBlocksByRange(requestBody as phase0.BeaconBlocksByRangeRequest);
        break;
      case Method.BeaconBlocksByRoot:
        yield* this.onBeaconBlocksByRoot(requestBody as phase0.BeaconBlocksByRootRequest);
        break;
      default:
        throw Error(`Unsupported method ${method}`);
    }
  }

  private async *onStatus(status: phase0.Status, peerId: PeerId): AsyncIterable<phase0.Status> {
    try {
      assertPeerRelevance(status, this.chain, this.config);
    } catch (e) {
      this.logger.debug("Irrelevant peer", {
        peer: peerId.toB58String(),
        reason: e instanceof LodestarError ? e.getMetadata() : e.message,
      });
      await this.network.reqResp.goodbye(peerId, BigInt(GoodByeReasonCode.IRRELEVANT_NETWORK));
      return;
    }

    // set status on peer
    this.network.peerMetadata.status.set(peerId, status);

    // send status response
    yield this.chain.getStatus();
  }

  private async *onGoodbye(requestBody: phase0.Goodbye, peerId: PeerId): AsyncIterable<bigint> {
    this.logger.verbose("Received goodbye request", {
      peer: peerId.toB58String(),
      reason: requestBody,
      description: GoodbyeReasonCodeDescriptions[requestBody.toString()],
    });

    yield BigInt(GoodByeReasonCode.CLIENT_SHUTDOWN);

    // # TODO: Will this line be called if the yield consumer returns? Consider using finally {}
    await this.network.disconnect(peerId);
  }

  private async *onPing(requestBody: phase0.Ping, peerId: PeerId): AsyncIterable<bigint> {
    yield this.network.metadata.seqNumber;

    // # TODO: Will this line be called if the yield consumer returns? Consider using finally {}
    // no need to wait
    handlePeerMetadataSequence(this.network, this.logger, peerId, requestBody).catch(() => {
      this.logger.warn("Failed to handle peer metadata sequence", {peerId: peerId.toB58String()});
    });
  }

  private async *onMetadata(): AsyncIterable<phase0.Metadata> {
    yield this.network.metadata.all;
  }

  private async *onBeaconBlocksByRange(
    requestBody: phase0.BeaconBlocksByRangeRequest
  ): AsyncIterable<phase0.SignedBeaconBlock> {
    if (requestBody.step < 1) {
      throw new ResponseError(RpcResponseStatus.INVALID_REQUEST, "step < 1");
    }
    if (requestBody.count < 1) {
      throw new ResponseError(RpcResponseStatus.INVALID_REQUEST, "count < 1");
    }
    if (requestBody.startSlot < GENESIS_SLOT) {
      throw new ResponseError(RpcResponseStatus.INVALID_REQUEST, "startSlot < genesis");
    }

    if (requestBody.count > MAX_REQUEST_BLOCKS) {
      requestBody.count = MAX_REQUEST_BLOCKS;
    }

    const archiveBlocksStream = this.db.blockArchive.valuesStream({
      gte: requestBody.startSlot,
      lt: requestBody.startSlot + requestBody.count * requestBody.step,
      step: requestBody.step,
    } as IBlockFilterOptions);
    yield* this.injectRecentBlocks(archiveBlocksStream, this.chain, requestBody);
  }

  private async *onBeaconBlocksByRoot(
    requestBody: phase0.BeaconBlocksByRootRequest
  ): AsyncIterable<phase0.SignedBeaconBlock> {
    const getBlock = this.db.block.get.bind(this.db.block);
    const getFinalizedBlock = this.db.blockArchive.getByRoot.bind(this.db.blockArchive);
    for (const blockRoot of requestBody) {
      const root = blockRoot.valueOf() as Uint8Array;
      const block = (await getBlock(root)) || (await getFinalizedBlock(root));
      if (block) {
        yield block;
      }
    }
  }

  private handshake = async (peerId: PeerId, direction: "inbound" | "outbound"): Promise<void> => {
    if (direction === "outbound") {
      const request = this.chain.getStatus();
      try {
        this.network.peerMetadata.status.set(peerId, await this.network.reqResp.status(peerId, request));
      } catch (e) {
        this.logger.verbose("Failed to get peer latest status and metadata", {
          peerId: peerId.toB58String(),
          error: e.message,
        });
        await this.network.disconnect(peerId);
      }
    }
  };

  private injectRecentBlocks = async function* (
    archiveStream: AsyncIterable<phase0.SignedBeaconBlock>,
    chain: IBeaconChain,
    request: phase0.BeaconBlocksByRangeRequest
  ): AsyncGenerator<phase0.SignedBeaconBlock> {
    let slot = -1;
    for await (const archiveBlock of archiveStream) {
      yield archiveBlock;
      slot = archiveBlock.message.slot;
    }
    slot = slot === -1 ? request.startSlot : slot + request.step;
    const upperSlot = request.startSlot + request.count * request.step;
    const slots = [] as number[];
    while (slot < upperSlot) {
      slots.push(slot);
      slot += request.step;
    }

    const blocks = (await chain.getUnfinalizedBlocksAtSlots(slots)) || [];
    for (const block of blocks) {
      if (block) {
        yield block;
      }
    }
  };
}
