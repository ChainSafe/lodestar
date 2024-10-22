import {FINALIZED_ROOT_DEPTH_ELECTRA, ForkBlobs, ForkExecution, ForkPostElectra} from "@lodestar/params";
import {
  BlockContents,
  SignedBeaconBlock,
  ExecutionPayload,
  ExecutionPayloadAndBlobsBundle,
  BeaconBlockBody,
  BeaconBlockOrContents,
  SignedBeaconBlockOrContents,
  ExecutionPayloadHeader,
  BlindedBeaconBlock,
  SignedBlindedBeaconBlock,
  BlindedBeaconBlockBody,
  SignedBlockContents,
  BeaconBlock,
  Attestation,
  LightClientUpdate,
  LightClientFinalityUpdate,
} from "../types.js";

export function isExecutionPayload<F extends ForkExecution>(
  payload: ExecutionPayload<F> | ExecutionPayloadHeader<F>
): payload is ExecutionPayload<F> {
  // we just check transactionsRoot for determining as it the base field
  // that is present and differs from ExecutionPayload for all forks
  return (payload as ExecutionPayload<F>).transactions !== undefined;
}

export function isExecutionPayloadHeader<F extends ForkExecution>(
  payload: ExecutionPayload<F> | ExecutionPayloadHeader<F>
): payload is ExecutionPayloadHeader<F> {
  // we just check transactionsRoot for determining as it the base field
  // that is present and differs from ExecutionPayload for all forks
  return (payload as ExecutionPayloadHeader<F>).transactionsRoot !== undefined;
}

export function isExecutionPayloadAndBlobsBundle<F extends ForkBlobs>(
  data: ExecutionPayload<ForkExecution> | ExecutionPayloadAndBlobsBundle<F>
): data is ExecutionPayloadAndBlobsBundle<F> {
  return (data as ExecutionPayloadAndBlobsBundle<ForkBlobs>).blobsBundle !== undefined;
}

export function isBlindedBeaconBlock<F extends ForkExecution>(
  block: BeaconBlockOrContents | SignedBeaconBlockOrContents
): block is BlindedBeaconBlock<F> {
  return (block as BeaconBlock).body !== null && isBlindedBeaconBlockBody((block as BeaconBlock).body);
}

export function isBlindedSignedBeaconBlock<F extends ForkExecution>(
  signedBlock: SignedBeaconBlock | SignedBeaconBlockOrContents
): signedBlock is SignedBlindedBeaconBlock<F> {
  return (signedBlock as SignedBlindedBeaconBlock<F>).message.body.executionPayloadHeader !== undefined;
}

export function isBlindedBeaconBlockBody<F extends ForkExecution>(
  body: BeaconBlockBody | BlindedBeaconBlockBody
): body is BlindedBeaconBlockBody<F> {
  return (body as BlindedBeaconBlockBody).executionPayloadHeader !== undefined;
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

export function isElectraAttestation(attestation: Attestation): attestation is Attestation<ForkPostElectra> {
  return (attestation as Attestation<ForkPostElectra>).committeeBits !== undefined;
}

export function isElectraLightClientUpdate(update: LightClientUpdate): update is LightClientUpdate<ForkPostElectra> {
  const updatePostElectra = update as LightClientUpdate<ForkPostElectra>;
  return (
    updatePostElectra.finalityBranch !== undefined &&
    updatePostElectra.finalityBranch.length === FINALIZED_ROOT_DEPTH_ELECTRA
  );
}

export function isELectraLightClientFinalityUpdate(
  update: LightClientFinalityUpdate
): update is LightClientFinalityUpdate<ForkPostElectra> {
  const updatePostElectra = update as LightClientUpdate<ForkPostElectra>;
  return (
    updatePostElectra.finalityBranch !== undefined &&
    updatePostElectra.finalityBranch.length === FINALIZED_ROOT_DEPTH_ELECTRA
  );
}
