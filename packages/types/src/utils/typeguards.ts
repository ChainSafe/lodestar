import {
  FullOrBlindedBeaconBlock,
  FullOrBlindedSignedBeaconBlock,
  FullOrBlindedExecutionPayload,
  ExecutionPayloadHeader,
} from "../allForks/types.js";
import {ts as bellatrix} from "../bellatrix/index.js";

export function isBlindedExecution(payload: FullOrBlindedExecutionPayload): payload is ExecutionPayloadHeader {
  // we just check transactionsRoot for determinging as it the base field
  // that is present and differs from ExecutionPayload for all forks
  return (payload as ExecutionPayloadHeader).transactionsRoot !== undefined;
}

export function isBlindedBeaconBlock(block: FullOrBlindedBeaconBlock): block is bellatrix.BlindedBeaconBlock {
  return (block as bellatrix.BlindedBeaconBlock).body.executionPayloadHeader !== undefined;
}

export function isBlindedSignedBeaconBlock(
  signedBlock: FullOrBlindedSignedBeaconBlock
): signedBlock is bellatrix.SignedBlindedBeaconBlock {
  return (signedBlock as bellatrix.SignedBlindedBeaconBlock).message.body.executionPayloadHeader !== undefined;
}
