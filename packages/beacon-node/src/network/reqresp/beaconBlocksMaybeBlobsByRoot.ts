import {PeerId} from "@libp2p/interface-peer-id";
import {BeaconConfig} from "@lodestar/config";
import {RequestError, RequestErrorCode} from "@lodestar/reqresp";
import {Epoch, phase0, Root, Slot} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {ForkSeq} from "@lodestar/params";
import {BlockInput, getBlockInput} from "../../chain/blocks/types.js";
import {wrapError} from "../../util/wrapError.js";
import {IReqRespBeaconNode} from "./interface.js";

export async function beaconBlocksMaybeBlobsByRoot(
  config: BeaconConfig,
  reqResp: IReqRespBeaconNode,
  peerId: PeerId,
  request: phase0.BeaconBlocksByRootRequest,
  currentSlot: Epoch,
  finalizedSlot: Slot
): Promise<BlockInput[]> {
  // Assume all requests are post Deneb
  if (config.getForkSeq(finalizedSlot) >= ForkSeq.deneb) {
    const blocksAndBlobs = await reqResp.beaconBlockAndBlobsSidecarByRoot(peerId, request);
    return blocksAndBlobs.map(({beaconBlock, blobsSidecar}) =>
      getBlockInput.postDeneb(config, beaconBlock, blobsSidecar)
    );
  }

  // Assume all request are pre EIP-4844
  else if (config.getForkSeq(currentSlot) < ForkSeq.deneb) {
    const blocks = await reqResp.beaconBlocksByRoot(peerId, request);
    return blocks.map((block) => getBlockInput.preDeneb(config, block));
  }

  // We don't know if a requested root is after the deneb fork or not.
  // Thus some sort of retry is necessary while deneb is not finalized
  else {
    return Promise.all(
      request.map(async (beaconBlockRoot) =>
        beaconBlockAndBlobsSidecarByRootFallback(config, reqResp, peerId, beaconBlockRoot)
      )
    );
  }
}

async function beaconBlockAndBlobsSidecarByRootFallback(
  config: BeaconConfig,
  reqResp: IReqRespBeaconNode,
  peerId: PeerId,
  beaconBlockRoot: Root
): Promise<BlockInput> {
  const resBlockBlobs = await wrapError(reqResp.beaconBlockAndBlobsSidecarByRoot(peerId, [beaconBlockRoot]));

  if (resBlockBlobs.err) {
    // From the spec, if the block is from before the fork, errors with 3: ResourceUnavailable
    // > Clients MUST support requesting blocks and sidecars since minimum_request_epoch, where
    //   minimum_request_epoch = max(finalized_epoch, current_epoch - MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS, DENEB_FORK_EPOCH).
    //   If any root in the request content references a block earlier than minimum_request_epoch,
    //   peers SHOULD respond with error code 3: ResourceUnavailable.
    // Ref: https://github.com/ethereum/consensus-specs/blob/aede132f4999ed54b98d35e27aca9451042a1ee9/specs/eip4844/p2p-interface.md#beaconblockandblobssidecarbyroot-v1
    if (
      resBlockBlobs.err instanceof RequestError &&
      resBlockBlobs.err.type.code === RequestErrorCode.RESOURCE_UNAVAILABLE
    ) {
      // retry with blocks
    } else {
      // Unexpected error, throw
      throw resBlockBlobs.err;
    }
  } else {
    if (resBlockBlobs.result.length < 1) {
      throw Error(`beaconBlockAndBlobsSidecarByRoot return empty for block root ${toHex(beaconBlockRoot)}`);
    }

    const {beaconBlock, blobsSidecar} = resBlockBlobs.result[0];
    return getBlockInput.postDeneb(config, beaconBlock, blobsSidecar);
  }

  const resBlocks = await reqResp.beaconBlocksByRoot(peerId, [beaconBlockRoot]);
  if (resBlocks.length < 1) {
    throw Error(`beaconBlocksByRoot return empty for block root ${toHex(beaconBlockRoot)}`);
  }

  return getBlockInput.preDeneb(config, resBlocks[0]);
}
