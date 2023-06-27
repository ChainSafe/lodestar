import {ChainForkConfig} from "@lodestar/config";
import {Epoch, phase0, deneb, Slot} from "@lodestar/types";
import {BlockInput, BlockSource} from "../../chain/blocks/types.js";
import {PeerIdStr} from "../../util/peerId.js";
import {INetwork} from "../interface.js";
import {matchBlockWithBlobs} from "./beaconBlocksMaybeBlobsByRange.js";

export async function beaconBlocksMaybeBlobsByRoot(
  config: ChainForkConfig,
  network: INetwork,
  peerId: PeerIdStr,
  request: phase0.BeaconBlocksByRootRequest,
  // TODO DENEB: Some validations can be done to see if this is deneb block, ignoring below two for now
  _currentSlot: Epoch,
  _finalizedSlot: Slot
): Promise<BlockInput[]> {
  const allBlocks = await network.sendBeaconBlocksByRoot(peerId, request);
  const blobIdentifiers: deneb.BlobIdentifier[] = [];

  for (const block of allBlocks) {
    const blockRoot = config.getForkTypes(block.data.message.slot).BeaconBlock.hashTreeRoot(block.data.message);
    const blobKzgCommitmentsLen = (block.data.message.body as deneb.BeaconBlockBody).blobKzgCommitments?.length ?? 0;
    for (let index = 0; index < blobKzgCommitmentsLen; index++) {
      blobIdentifiers.push({blockRoot, index});
    }
  }

  let allBlobSidecars: deneb.BlobSidecar[];
  if (blobIdentifiers.length > 0) {
    allBlobSidecars = await network.sendBlobSidecarsByRoot(peerId, blobIdentifiers);
  } else {
    allBlobSidecars = [];
  }

  // The last arg is to provide slot to which all blobs should be exausted in matching
  // and here it should be infinity since all bobs should match
  return matchBlockWithBlobs(config, allBlocks, allBlobSidecars, Infinity, BlockSource.byRoot);
}
