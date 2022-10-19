import {ExecutionFork} from "@lodestar/params";
import {BeaconBlock, SignedBeaconBlock, BlindedOrFull} from "../allForks/types.js";

export function isBlindedBeaconBlock<F extends ExecutionFork = ExecutionFork>(
  block: BeaconBlock<F, BlindedOrFull>
): block is BeaconBlock<F, "blinded"> {
  return (block as BeaconBlock<F, "blinded">).body.executionPayloadHeader !== undefined;
}

export function isBlindedSignedBeaconBlock<F extends ExecutionFork = ExecutionFork>(
  signedBlock: SignedBeaconBlock<F, BlindedOrFull>
): signedBlock is SignedBeaconBlock<F, "blinded"> {
  return (signedBlock as SignedBeaconBlock<F, "blinded">).message.body.executionPayloadHeader !== undefined;
}
