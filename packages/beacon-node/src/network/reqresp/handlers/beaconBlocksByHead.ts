import {PeerId} from "@libp2p/interface";
import {BeaconConfig} from "@lodestar/config";
import {GENESIS_EPOCH, GENESIS_SLOT} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {fulu} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {getParentRootFromSignedBeaconBlockSerialized} from "../../../util/sszBytes.js";
import {prettyPrintPeerId} from "../../util.js";

export async function* onBeaconBlocksByHead(
  request: fulu.BeaconBlocksByHeadRequest,
  chain: IBeaconChain,
  peerId: PeerId,
  peerClient: string
): AsyncIterable<ResponseOutgoing> {
  const {beaconRoot, count} = validateBeaconBlocksByHeadRequest(chain.config, request);

  const requestedRootHex = toRootHex(beaconRoot);
  let blockRootHex = requestedRootHex;
  const minimumRequestEpoch = Math.max(
    GENESIS_EPOCH,
    chain.clock.currentEpoch - chain.config.MIN_EPOCHS_FOR_BLOCK_REQUESTS
  );
  const minimumRequestSlot = computeStartSlotAtEpoch(minimumRequestEpoch);

  for (let blocksSent = 0; blocksSent < count; blocksSent++) {
    const blockBytes = await chain.getSerializedBlockByRoot(blockRootHex);
    if (!blockBytes) {
      if (blocksSent === 0) {
        throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, `Unknown block root ${requestedRootHex}`);
      }
      return;
    }

    if (blockBytes.slot < minimumRequestSlot) {
      if (blocksSent === 0) {
        chain.logger.verbose("Peer requested unavailable block for BeaconBlocksByHead", {
          peer: prettyPrintPeerId(peerId),
          client: peerClient,
          requestedRoot: requestedRootHex,
          slot: blockBytes.slot,
          minimumRequestSlot,
        });
      }
      return;
    }

    yield {
      data: blockBytes.block,
      boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(blockBytes.slot)),
    };

    if (blockBytes.slot === GENESIS_SLOT) {
      return;
    }

    const parentRootHex = getParentRootFromSignedBeaconBlockSerialized(blockBytes.block);
    if (parentRootHex === null) {
      throw new ResponseError(
        RespStatus.SERVER_ERROR,
        `Invalid block bytes for root ${blockRootHex} slot ${blockBytes.slot}`
      );
    }
    blockRootHex = parentRootHex;
  }
}

export function validateBeaconBlocksByHeadRequest(
  config: BeaconConfig,
  request: fulu.BeaconBlocksByHeadRequest
): fulu.BeaconBlocksByHeadRequest {
  const {beaconRoot} = request;
  let {count} = request;

  if (count < 0) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "count < 0");
  }

  if (count > config.MAX_REQUEST_BLOCKS_DENEB) {
    count = config.MAX_REQUEST_BLOCKS_DENEB;
  }

  return {beaconRoot, count};
}
