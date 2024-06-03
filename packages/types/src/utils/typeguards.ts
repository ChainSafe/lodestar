import {ForkAll, ForkBlobs, ForkExecution} from "@lodestar/params";
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

export function isExecutionPayloadAndBlobsBundle<F extends ForkBlobs>(
  data: ExecutionPayload<ForkExecution> | ExecutionPayloadAndBlobsBundle<F>
): data is ExecutionPayloadAndBlobsBundle<F> {
  return (data as ExecutionPayloadAndBlobsBundle<ForkBlobs>).blobsBundle !== undefined;
}

export function isBlindedBeaconBlock<F extends ForkAll>(
  block: BeaconBlockOrContents | SignedBeaconBlockOrContents
): block is BeaconBlock<F, "blinded"> {
  return "body" in block && block.body !== undefined && block.body !== null && isBlindedBeaconBlockBody(block.body);
}

export function isBlindedSignedBeaconBlock<F extends ForkAll>(
  signedBlock: SignedBeaconBlock<F, FullOrBlinded> | SignedBeaconBlockOrContents<F>
): signedBlock is SignedBeaconBlock<F, "blinded"> {
  return (signedBlock as SignedBeaconBlock<F, "blinded">).message.body.executionPayloadHeader !== undefined;
}

export function isBlindedBeaconBlockBody<F extends ForkAll>(
  body: BeaconBlockBody<F, FullOrBlinded>
): body is BeaconBlockBody<F, "blinded"> {
  return "executionPayloadHeader" in body && body.executionPayloadHeader !== undefined;
}

export function isBlockContents<F extends ForkBlobs>(
  data: BeaconBlockOrContents | SignedBeaconBlockOrContents
): data is BlockContents<F, "unsigned"> {
  return (data as BlockContents<F, "unsigned">).kzgProofs !== undefined;
}

export function isSignedBlockContents<F extends ForkBlobs>(
  data: SignedBeaconBlockOrContents | BeaconBlockOrContents
): data is BlockContents<F, "signed"> {
  return (data as BlockContents<F, "signed">).kzgProofs !== undefined;
}
