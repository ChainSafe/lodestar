import {PeerId} from "@libp2p/interface-peer-id";
import {IBeaconConfig} from "@lodestar/config";
import {deneb, Epoch, phase0} from "@lodestar/types";
import {ForkSeq} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";

import {BlockInput, getBlockInput} from "../../chain/blocks/types.js";
import {ckzg} from "../../util/kzg.js";
import {IReqRespBeaconNode} from "./interface.js";

export async function doBeaconBlocksMaybeBlobsByRange(
  config: IBeaconConfig,
  reqResp: IReqRespBeaconNode,
  peerId: PeerId,
  request: phase0.BeaconBlocksByRangeRequest,
  currentEpoch: Epoch
): Promise<BlockInput[]> {
  // TODO Deneb: Assumes all blocks in the same epoch
  // TODO Deneb: Ensure all blocks are in the same epoch
  if (config.getForkSeq(request.startSlot) < ForkSeq.deneb) {
    const blocks = await reqResp.beaconBlocksByRange(peerId, request);
    return blocks.map((block) => getBlockInput.preDeneb(config, block));
  }

  // Only request blobs if they are recent enough
  else if (computeEpochAtSlot(request.startSlot) >= currentEpoch - config.MIN_EPOCHS_FOR_BLOBS_SIDECARS_REQUESTS) {
    // TODO Deneb: Do two requests at once for blocks and blobs
    const blocks = await reqResp.beaconBlocksByRange(peerId, request);
    const blobsSidecars = await reqResp.blobsSidecarsByRange(peerId, request);

    const blockInputs: BlockInput[] = [];
    let blobSideCarIndex = 0;
    let lastMatchedSlot = -1;

    const emptyKzgAggregatedProof = ckzg.computeAggregateKzgProof([]);

    // Match blobSideCar with the block as some blocks would have no blobs and hence
    // would be omitted from the response. If there are any inconsitencies in the
    // response, the validations during import will reject the block and hence this
    // entire segment.
    //
    // Assuming that the blocks and blobs will come in same sorted order
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      let blobsSidecar: deneb.BlobsSidecar;

      if (blobsSidecars[blobSideCarIndex]?.beaconBlockSlot === block.message.slot) {
        blobsSidecar = blobsSidecars[blobSideCarIndex];
        lastMatchedSlot = block.message.slot;
        blobSideCarIndex++;
      } else {
        // Quick inspect if the blobsSidecar was expected
        const blobKzgCommitmentsLen = (block.message.body as deneb.BeaconBlockBody).blobKzgCommitments.length;
        if (blobKzgCommitmentsLen !== 0) {
          throw Error(
            `Missing blobsSidecar for blockSlot=${block.message.slot} with blobKzgCommitmentsLen=${blobKzgCommitmentsLen}`
          );
        }
        blobsSidecar = {
          beaconBlockRoot: config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message),
          beaconBlockSlot: block.message.slot,
          blobs: [],
          kzgAggregatedProof: emptyKzgAggregatedProof,
        };
      }
      blockInputs.push(getBlockInput.postDeneb(config, block, blobsSidecar));
    }

    // If there are still unconsumed blobs this means that the response was inconsistent
    // and matching was wrong and hence we should throw error
    if (blobsSidecars[blobSideCarIndex] !== undefined) {
      throw Error(
        `Unmatched blobsSidecars, blocks=${blocks.length}, blobs=${
          blobsSidecars.length
        } lastMatchedSlot=${lastMatchedSlot}, pending blobsSidecars slots=${blobsSidecars
          .slice(blobSideCarIndex)
          .map((blb) => blb.beaconBlockSlot)}`
      );
    }
    return blockInputs;
  }

  // Post Deneb but old blobs
  else {
    const blocks = await reqResp.beaconBlocksByRange(peerId, request);
    return blocks.map((block) => getBlockInput.postDenebOldBlobs(config, block));
  }
}
