import {ChainForkConfig} from "@lodestar/config";
import {deneb, Epoch, phase0, allForks, Slot} from "@lodestar/types";
import {ForkSeq, MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";

import {BlockInput, BlockSource, getBlockInput, blobSidecarsToBlobsSidecar} from "../../chain/blocks/types.js";
import {PeerIdStr} from "../../util/peerId.js";
import {INetwork} from "../interface.js";

export async function beaconBlocksMaybeBlobsByRange(
  config: ChainForkConfig,
  network: INetwork,
  peerId: PeerIdStr,
  request: phase0.BeaconBlocksByRangeRequest,
  currentEpoch: Epoch
): Promise<BlockInput[]> {
  // Code below assumes the request is in the same epoch
  // Range sync satisfies this condition, but double check here for sanity
  const {startSlot, count} = request;
  if (count < 1) {
    return [];
  }
  const endSlot = startSlot + count - 1;

  const startEpoch = computeEpochAtSlot(startSlot);
  const endEpoch = computeEpochAtSlot(endSlot);
  if (startEpoch !== endEpoch) {
    throw Error(
      `BeaconBlocksByRangeRequest must be in the same epoch startEpoch=${startEpoch} != endEpoch=${endEpoch}`
    );
  }

  // Note: Assumes all blocks in the same epoch
  if (config.getForkSeq(startSlot) < ForkSeq.deneb) {
    const blocks = await network.sendBeaconBlocksByRange(peerId, request);
    return blocks.map((block) => getBlockInput.preDeneb(config, block, BlockSource.byRange));
  }

  // Only request blobs if they are recent enough
  else if (computeEpochAtSlot(startSlot) >= currentEpoch - MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS) {
    const [allBlocks, allBlobSidecars] = await Promise.all([
      network.sendBeaconBlocksByRange(peerId, request),
      network.sendBlobSidecarsByRange(peerId, request),
    ]);

    return matchBlockWithBlobs(config, allBlocks, allBlobSidecars, endSlot, BlockSource.byRange);
  }

  // Post Deneb but old blobs
  else {
    throw Error("Cannot sync blobs outside of blobs prune window");
  }
}

// Assumes that the blobs are in the same sequence as blocks, doesn't require block to be sorted
export function matchBlockWithBlobs(
  config: ChainForkConfig,
  allBlocks: allForks.SignedBeaconBlock[],
  allBlobSidecars: deneb.BlobSidecar[],
  endSlot: Slot,
  blockSource: BlockSource
): BlockInput[] {
  const blockInputs: BlockInput[] = [];
  let blobSideCarIndex = 0;
  let lastMatchedSlot = -1;

  // Match blobSideCar with the block as some blocks would have no blobs and hence
  // would be omitted from the response. If there are any inconsitencies in the
  // response, the validations during import will reject the block and hence this
  // entire segment.
  //
  // Assuming that the blocks and blobs will come in same sorted order
  for (let i = 0; i < allBlocks.length; i++) {
    const block = allBlocks[i];
    if (config.getForkSeq(block.message.slot) < ForkSeq.deneb) {
      blockInputs.push(getBlockInput.preDeneb(config, block, blockSource));
    } else {
      const blobSidecars: deneb.BlobSidecar[] = [];

      let blobSidecar: deneb.BlobSidecar;
      while ((blobSidecar = allBlobSidecars[blobSideCarIndex])?.slot === block.message.slot) {
        blobSidecars.push(blobSidecar);
        lastMatchedSlot = block.message.slot;
        blobSideCarIndex++;
      }

      // Quick inspect how many blobSidecars was expected
      const blobKzgCommitmentsLen = (block.message.body as deneb.BeaconBlockBody).blobKzgCommitments.length;
      if (blobKzgCommitmentsLen !== blobSidecars.length) {
        throw Error(
          `Missing blobSidecars for blockSlot=${block.message.slot} with blobKzgCommitmentsLen=${blobKzgCommitmentsLen} blobSidecars=${blobSidecars.length}`
        );
      }

      // TODO DENEB: cleanup blobSidecars to blobsSidecar conversion on migration of blockInput
      const blobsSidecar = blobSidecarsToBlobsSidecar(config, block, blobSidecars);
      blockInputs.push(getBlockInput.postDeneb(config, block, blockSource, blobsSidecar));
    }
  }

  // If there are still unconsumed blobs this means that the response was inconsistent
  // and matching was wrong and hence we should throw error
  if (
    allBlobSidecars[blobSideCarIndex] !== undefined &&
    // If there are no blobs, the blobs request can give 1 block outside the requested range
    allBlobSidecars[blobSideCarIndex].slot <= endSlot
  ) {
    throw Error(
      `Unmatched blobSidecars, blocks=${allBlocks.length}, blobs=${
        allBlobSidecars.length
      } lastMatchedSlot=${lastMatchedSlot}, pending blobSidecars slots=${allBlobSidecars
        .slice(blobSideCarIndex)
        .map((blb) => blb.slot)
        .join(",")}`
    );
  }
  return blockInputs;
}
