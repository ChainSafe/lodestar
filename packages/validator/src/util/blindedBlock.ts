import {IChainForkConfig} from "@lodestar/config";
import {allForks, bellatrix, phase0, Root, ssz} from "@lodestar/types";

export function blindedOrFullBlockHashTreeRoot(
  config: IChainForkConfig,
  blindedOrFull: allForks.FullOrBlindedBeaconBlock
): Root {
  return isBlindedBlock(blindedOrFull)
    ? // Blinded
      ssz.bellatrix.BlindedBeaconBlock.hashTreeRoot(blindedOrFull)
    : // Full
      config.getForkTypes(blindedOrFull.slot).BeaconBlock.hashTreeRoot(blindedOrFull);
}

export function blindedOrFullBlockToHeader(
  config: IChainForkConfig,
  blindedOrFull: allForks.FullOrBlindedBeaconBlock
): phase0.BeaconBlockHeader {
  const bodyRoot = isBlindedBlock(blindedOrFull)
    ? // Blinded
      ssz.bellatrix.BlindedBeaconBlockBody.hashTreeRoot(blindedOrFull.body)
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

/** Typeguard for ternary operators */
function isBlindedBlock(
  blindedOrFull: allForks.FullOrBlindedBeaconBlock
): blindedOrFull is bellatrix.BlindedBeaconBlock {
  return (blindedOrFull.body as bellatrix.BlindedBeaconBlockBody).executionPayloadHeader !== undefined;
}
