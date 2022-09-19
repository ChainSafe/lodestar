import {FullOrBlindedBeaconBlock, FullOrBlindedSignedBeaconBlock} from "../allForks/types.js";
import {ts as bellatrix} from "../bellatrix/index.js";

export function isBlindedBeaconBlock(block: FullOrBlindedBeaconBlock): block is bellatrix.BlindedBeaconBlock {
  return (block as bellatrix.BlindedBeaconBlock).body.executionPayloadHeader !== undefined;
}

export function isBlindedSignedBeaconBlock(
  signedBlock: FullOrBlindedSignedBeaconBlock
): signedBlock is bellatrix.SignedBlindedBeaconBlock {
  return (signedBlock as bellatrix.SignedBlindedBeaconBlock).message.body.executionPayloadHeader !== undefined;
}
