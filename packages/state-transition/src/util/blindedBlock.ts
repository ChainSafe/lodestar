import {ChainForkConfig} from "@lodestar/config";
import {allForks, phase0, Root, isBlindedBeaconBlock, isBlindedBlobSidecar} from "@lodestar/types";

export function blindedOrFullBlockHashTreeRoot(
  config: ChainForkConfig,
  blindedOrFull: allForks.FullOrBlindedBeaconBlock
): Root {
  return isBlindedBeaconBlock(blindedOrFull)
    ? // Blinded
      config.getBlindedForkTypes(blindedOrFull.slot).BeaconBlock.hashTreeRoot(blindedOrFull)
    : // Full
      config.getForkTypes(blindedOrFull.slot).BeaconBlock.hashTreeRoot(blindedOrFull);
}

export function blindedOrFullBlobSidecarHashTreeRoot(
  config: ChainForkConfig,
  blindedOrFull: allForks.FullOrBlindedBlobSidecar
): Root {
  return isBlindedBlobSidecar(blindedOrFull)
    ? // Blinded
      config.getBlobsForkTypes(blindedOrFull.slot).BlindedBlobSidecar.hashTreeRoot(blindedOrFull)
    : // Full
      config.getBlobsForkTypes(blindedOrFull.slot).BlobSidecar.hashTreeRoot(blindedOrFull);
}

export function blindedOrFullBlockToHeader(
  config: ChainForkConfig,
  blindedOrFull: allForks.FullOrBlindedBeaconBlock
): phase0.BeaconBlockHeader {
  const bodyRoot = isBlindedBeaconBlock(blindedOrFull)
    ? // Blinded
      config.getBlindedForkTypes(blindedOrFull.slot).BeaconBlockBody.hashTreeRoot(blindedOrFull.body)
    : // Full
      config.getForkTypes(blindedOrFull.slot).BeaconBlockBody.hashTreeRoot(blindedOrFull.body);

  return {
    slot: blindedOrFull.slot,
    proposerIndex: blindedOrFull.proposerIndex,
    parentRoot: blindedOrFull.parentRoot,
    stateRoot: blindedOrFull.stateRoot,
    bodyRoot,
  };
}
