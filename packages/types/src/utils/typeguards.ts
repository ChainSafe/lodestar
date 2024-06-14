import {ForkBlobs, ForkExecution} from "@lodestar/params";
import {
  BlockContents,
  SignedBeaconBlock,
  ExecutionPayload,
  ExecutionPayloadAndBlobsBundle,
  BeaconBlockBody,
  BeaconBlockOrContents,
  SignedBeaconBlockOrContents,
  BlindedExecutionPayload,
  BlindedBeaconBlock,
  SignedBlindedBeaconBlock,
  BlindedBeaconBlockBody,
  SignedBlockContents,
} from "../types.js";

export function isExecutionPayload<F extends ForkExecution>(
  payload: ExecutionPayload<F> | BlindedExecutionPayload<F>
): payload is ExecutionPayload<F> {
  // we just check transactionsRoot for determining as it the base field
  // that is present and differs from ExecutionPayload for all forks
  return (payload as ExecutionPayload<F>).transactions !== undefined;
}

export function isBlindedExecutionPayload<F extends ForkExecution>(
  payload: ExecutionPayload<F> | BlindedExecutionPayload<F>
): payload is BlindedExecutionPayload<F> {
  // we just check transactionsRoot for determining as it the base field
  // that is present and differs from ExecutionPayload for all forks
  return (payload as BlindedExecutionPayload<F>).transactionsRoot !== undefined;
}

export function isExecutionPayloadAndBlobsBundle<F extends ForkBlobs>(
  data: ExecutionPayload<ForkExecution> | ExecutionPayloadAndBlobsBundle<F>
): data is ExecutionPayloadAndBlobsBundle<F> {
  return (data as ExecutionPayloadAndBlobsBundle<ForkBlobs>).blobsBundle !== undefined;
}

export function isBlindedBeaconBlock<F extends ForkExecution>(
  block: BeaconBlockOrContents | SignedBeaconBlockOrContents
): block is BlindedBeaconBlock<F> {
  return "body" in block && block.body !== undefined && block.body !== null && isBlindedBeaconBlockBody(block.body);
}

export function isBlindedSignedBeaconBlock<F extends ForkExecution>(
  signedBlock: SignedBeaconBlock | SignedBeaconBlockOrContents
): signedBlock is SignedBlindedBeaconBlock<F> {
  return (signedBlock as SignedBlindedBeaconBlock<F>).message.body.executionPayloadHeader !== undefined;
}

export function isBlindedBeaconBlockBody<F extends ForkExecution>(
  body: BeaconBlockBody
): body is BlindedBeaconBlockBody<F> {
  return "executionPayloadHeader" in body && body.executionPayloadHeader !== undefined;
}

export function isBlockContents<F extends ForkBlobs>(
  data: BeaconBlockOrContents | SignedBeaconBlockOrContents
): data is BlockContents<F> {
  return (data as BlockContents<F>).kzgProofs !== undefined;
}

export function isSignedBlockContents<F extends ForkBlobs>(
  data: SignedBeaconBlockOrContents | BeaconBlockOrContents
): data is SignedBlockContents<F> {
  return (data as SignedBlockContents<F>).kzgProofs !== undefined;
}
