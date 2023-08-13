import {
  FullOrBlindedBeaconBlockOrContents,
  FullOrBlindedBeaconBlock,
  FullOrBlindedSignedBeaconBlock,
  FullOrBlindedBeaconBlockBody,
  FullOrBlindedExecutionPayload,
  ExecutionPayloadHeader,
  FullOrBlindedBlobSidecar,
  FullOrBlindedSignedBlobSidecar,
  BlindedBeaconBlockBody,
  BlindedBeaconBlock,
  BlockContents,
  SignedBlindedBlockContents,
  SignedBlindedBeaconBlock,
  BlindedBlockContents,
  SignedBlockContents,
  SignedBeaconBlock,
  SignedBlindedBeaconBlockOrContents,
} from "../allForks/types.js";
import {ts as deneb} from "../deneb/index.js";

export function isBlindedExecution(payload: FullOrBlindedExecutionPayload): payload is ExecutionPayloadHeader {
  // we just check transactionsRoot for determinging as it the base field
  // that is present and differs from ExecutionPayload for all forks
  return (payload as ExecutionPayloadHeader).transactionsRoot !== undefined;
}

export function isBlindedBeaconBlock(block: FullOrBlindedBeaconBlockOrContents): block is BlindedBeaconBlock {
  const body = (block as FullOrBlindedBeaconBlock).body;
  return body !== undefined && isBlindedBeaconBlockBody(body);
}

export function isBlindedBeaconBlockBody(body: FullOrBlindedBeaconBlockBody): body is BlindedBeaconBlockBody {
  return (body as BlindedBeaconBlockBody).executionPayloadHeader !== undefined;
}

export function isBlindedSignedBeaconBlock(
  signedBlock: FullOrBlindedSignedBeaconBlock
): signedBlock is SignedBlindedBeaconBlock {
  return (signedBlock as SignedBlindedBeaconBlock).message.body.executionPayloadHeader !== undefined;
}

export function isBlindedBlobSidecar(blob: FullOrBlindedBlobSidecar): blob is deneb.BlindedBlobSidecar {
  return (blob as deneb.BlindedBlobSidecar).blobRoot !== undefined;
}

export function isBlindedSignedBlobSidecar(
  blob: FullOrBlindedSignedBlobSidecar
): blob is deneb.SignedBlindedBlobSidecar {
  return (blob as deneb.SignedBlindedBlobSidecar).message.blobRoot !== undefined;
}

export function isBlockContents(data: FullOrBlindedBeaconBlockOrContents): data is BlockContents {
  return (data as BlockContents).blobSidecars !== undefined;
}

export function isSignedBlockContents(data: SignedBeaconBlock | SignedBlockContents): data is SignedBlockContents {
  return (data as SignedBlockContents).signedBlobSidecars !== undefined;
}

export function isBlindedBlockContents(data: FullOrBlindedBeaconBlockOrContents): data is BlindedBlockContents {
  return (data as BlindedBlockContents).blindedBlobSidecars !== undefined;
}

export function isSignedBlindedBlockContents(
  data: SignedBlindedBeaconBlockOrContents
): data is SignedBlindedBlockContents {
  return (data as SignedBlindedBlockContents).signedBlindedBlobSidecars !== undefined;
}
