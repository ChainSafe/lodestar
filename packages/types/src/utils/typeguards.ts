import {ForkBlobs, ForkExecution, ForkName} from "@lodestar/params";
import {
  BlockContents,
  SignedBeaconBlock,
  ExecutionPayload,
  ExecutionPayloadAndBlobsBundle,
  FullOrBlinded,
  BeaconBlock,
  BeaconBlockBody,
  BeaconBlockOrContents,
  SignedBeaconBlockOrContents,
} from "../types.js";

export function isExecutionPayload<F extends ForkExecution>(
  payload: ExecutionPayload<F, FullOrBlinded>
): payload is ExecutionPayload<F, "full"> {
  // we just check transactionsRoot for determining as it the base field
  // that is present and differs from ExecutionPayload for all forks
  return (payload as ExecutionPayload<F, "full">).transactions !== undefined;
}

export function isBlindedExecutionPayload<F extends ForkExecution>(
  payload: ExecutionPayload<F, FullOrBlinded>
): payload is ExecutionPayload<F, "blinded"> {
  // we just check transactionsRoot for determining as it the base field
  // that is present and differs from ExecutionPayload for all forks
  return (payload as ExecutionPayload<F, "blinded">).transactionsRoot !== undefined;
}

export function isBlindedBeaconBlock<F extends ForkName>(
  block: BeaconBlock<F, FullOrBlinded>
): block is BeaconBlock<F, "blinded"> {
  return "body" in block && block.body !== undefined && block.body !== null && isBlindedBeaconBlockBody(block.body);
}

export function isBlindedBeaconBlockBody<F extends ForkName>(
  body: BeaconBlockBody<F, FullOrBlinded>
): body is BeaconBlockBody<F, "blinded"> {
  return "executionPayloadHeader" in body && body.executionPayloadHeader !== undefined;
}

export function isBlindedSignedBeaconBlock<F extends ForkName>(
  signedBlock: SignedBeaconBlock<F, FullOrBlinded>
): signedBlock is SignedBeaconBlock<F, "blinded"> {
  return (signedBlock as SignedBeaconBlock<F, "blinded">).message.body.executionPayloadHeader !== undefined;
}

export function isBlockContents<F extends ForkBlobs>(
  data: BeaconBlockOrContents<F>
): data is BlockContents<F, "unsigned"> {
  return (data as BlockContents<F, "unsigned">).kzgProofs !== undefined;
}

export function isSignedBlockContents<F extends ForkBlobs>(
  data: SignedBeaconBlockOrContents<F>
): data is BlockContents<F, "signed"> {
  return (data as BlockContents<F, "signed">).kzgProofs !== undefined;
}

export function isExecutionPayloadAndBlobsBundle<F extends ForkExecution>(
  data: ExecutionPayload<F, "full"> | ExecutionPayloadAndBlobsBundle<ForkBlobs>
): data is ExecutionPayloadAndBlobsBundle<ForkBlobs> {
  return (data as ExecutionPayloadAndBlobsBundle<ForkBlobs>).blobsBundle !== undefined;
}
