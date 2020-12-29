/**
 * @module sync
 */

import {computeStartSlotAtEpoch, GENESIS_SLOT, getBlockRootAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  BeaconBlocksByRangeRequest,
  BeaconBlocksByRootRequest,
  Goodbye,
  MAX_REQUEST_BLOCKS,
  Metadata,
  Ping,
  RequestBody,
  ResponseBody,
  SignedBeaconBlock,
  Status,
} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import PeerId from "peer-id";
import {IBeaconChain} from "../../chain";
import {GENESIS_EPOCH, Method, ReqRespEncoding, RpcResponseStatus, ZERO_HASH} from "../../constants";
import {IBeaconDb} from "../../db";
import {IBlockFilterOptions} from "../../db/api/beacon/repositories";
import {createRpcProtocol, INetwork} from "../../network";
import {ResponseError} from "../../network/reqresp/response";
import {handlePeerMetadataSequence} from "../../network/peers/utils";
import {createStatus, syncPeersStatus} from "../utils/sync";
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
    this.network.on("peer:connect", this.handshake);
    const myStatus = await createStatus(this.chain);
    await syncPeersStatus(this.network, myStatus);
  }

  public async stop(): Promise<void> {
    this.network.removeListener("peer:connect", this.handshake);
    await Promise.all(
      this.network
        .getPeers({connected: true, supportsProtocols: [createRpcProtocol(Method.Goodbye, ReqRespEncoding.SSZ_SNAPPY)]})
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

  public async *onRequest(method: Method, requestBody: RequestBody, peerId: PeerId): AsyncIterable<ResponseBody> {
    switch (method) {
      case Method.Status:
        yield* this.onStatus(requestBody as Status, peerId);
        break;
      case Method.Goodbye:
        yield* this.onGoodbye(requestBody as Goodbye, peerId);
        break;
      case Method.Ping:
        yield* this.onPing(requestBody as Ping, peerId);
        break;
      case Method.Metadata:
        yield* this.onMetadata();
        break;
      case Method.BeaconBlocksByRange:
        yield* this.onBeaconBlocksByRange(requestBody as BeaconBlocksByRangeRequest);
        break;
      case Method.BeaconBlocksByRoot:
        yield* this.onBeaconBlocksByRoot(requestBody as BeaconBlocksByRootRequest);
        break;
      default:
        throw Error(`Unsupported method ${method}`);
    }
  }

  private async *onStatus(requestBody: Status, peerId: PeerId): AsyncIterable<Status> {
    if (await this.shouldDisconnectOnStatus(requestBody)) {
      try {
        await this.network.reqResp.goodbye(peerId, BigInt(GoodByeReasonCode.IRRELEVANT_NETWORK));
      } catch {
        // ignore error
        return;
      }
    }

    // set status on peer
    this.network.peerMetadata.setStatus(peerId, requestBody);

    // send status response
    yield await createStatus(this.chain);
  }

  private async shouldDisconnectOnStatus(request: Status): Promise<boolean> {
    const currentForkDigest = await this.chain.getForkDigest();
    if (!this.config.types.ForkDigest.equals(currentForkDigest, request.forkDigest)) {
      this.logger.verbose("Fork digest mismatch", {
        expected: toHexString(currentForkDigest),
        received: toHexString(request.forkDigest),
      });
      return true;
    }
    if (request.finalizedEpoch === GENESIS_EPOCH) {
      if (!this.config.types.Root.equals(request.finalizedRoot, ZERO_HASH)) {
        this.logger.verbose("Genesis finalized root must be zeroed", {
          expected: toHexString(ZERO_HASH),
          received: toHexString(request.finalizedRoot),
        });
        return true;
      }
    } else {
      // we're on a further (or equal) finalized epoch
      // but the peer's block root at that epoch may not match match ours
      const headSummary = this.chain.forkChoice.getHead();
      const finalizedCheckpoint = this.chain.forkChoice.getFinalizedCheckpoint();
      const requestFinalizedSlot = computeStartSlotAtEpoch(this.config, request.finalizedEpoch);

      if (request.finalizedEpoch === finalizedCheckpoint.epoch) {
        if (!this.config.types.Root.equals(request.finalizedRoot, finalizedCheckpoint.root)) {
          this.logger.verbose("Status with same finalized epoch has different root", {
            expected: toHexString(finalizedCheckpoint.root),
            received: toHexString(request.finalizedRoot),
          });
          return true;
        }
      } else if (request.finalizedEpoch < finalizedCheckpoint.epoch) {
        // If it is within recent history, we can directly check against the block roots in the state
        if (headSummary.slot - requestFinalizedSlot < this.config.params.SLOTS_PER_HISTORICAL_ROOT) {
          const headState = await this.chain.getHeadState();
          // This will get the latest known block at the start of the epoch.
          const expected = getBlockRootAtSlot(this.config, headState, requestFinalizedSlot);
          if (!this.config.types.Root.equals(request.finalizedRoot, expected)) {
            this.logger.verbose("Status with different finalized root", {
              received: toHexString(request.finalizedRoot),
              epected: toHexString(expected),
              epoch: request.finalizedEpoch,
            });
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
          return false;
        }
      } else {
        // request status finalized checkpoint is in the future, we do not know if it is a true finalized root
        this.logger.verbose("Status with future finalized epoch", {
          finalizedEpoch: request.finalizedEpoch,
          finalizedRoot: toHexString(request.finalizedRoot),
        });
      }
    }
    return false;
  }

  private async *onGoodbye(requestBody: Goodbye, peerId: PeerId): AsyncIterable<bigint> {
    this.logger.info("Received goodbye request", {
      peer: peerId.toB58String(),
      reason: requestBody,
      description: GoodbyeReasonCodeDescriptions[requestBody.toString()],
    });

    yield BigInt(GoodByeReasonCode.CLIENT_SHUTDOWN);

    // # TODO: Will this line be called if the yield consumer returns? Consider using finally {}
    await this.network.disconnect(peerId);
  }

  private async *onPing(requestBody: Ping, peerId: PeerId): AsyncIterable<bigint> {
    yield this.network.metadata.seqNumber;

    // # TODO: Will this line be called if the yield consumer returns? Consider using finally {}
    // no need to wait
    handlePeerMetadataSequence(this.network, this.logger, peerId, requestBody).catch(() => {
      this.logger.warn("Failed to handle peer metadata sequence", {peerId: peerId.toB58String()});
    });
  }

  private async *onMetadata(): AsyncIterable<Metadata> {
    yield this.network.metadata.metadata;
  }

  private async *onBeaconBlocksByRange(requestBody: BeaconBlocksByRangeRequest): AsyncIterable<SignedBeaconBlock> {
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

  private async *onBeaconBlocksByRoot(requestBody: BeaconBlocksByRootRequest): AsyncIterable<SignedBeaconBlock> {
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
      const request = await createStatus(this.chain);
      try {
        this.network.peerMetadata.setStatus(peerId, await this.network.reqResp.status(peerId, request));
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
    archiveStream: AsyncIterable<SignedBeaconBlock>,
    chain: IBeaconChain,
    request: BeaconBlocksByRangeRequest
  ): AsyncGenerator<SignedBeaconBlock> {
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
