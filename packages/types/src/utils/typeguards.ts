import {
  FullOrBlindedBeaconBlockOrContents,
  FullOrBlindedBeaconBlock,
  FullOrBlindedSignedBeaconBlock,
  FullOrBlindedBeaconBlockBody,
  FullOrBlindedExecutionPayload,
  ExecutionPayloadHeader,
  BlindedBeaconBlockBody,
  BlindedBeaconBlock,
  BlockContents,
  SignedBlindedBeaconBlock,
  SignedBlockContents,
  SignedBeaconBlock,
  ExecutionPayload,
  ExecutionPayloadAndBlobsBundle,
} from "../allForks/types.js";

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

export function isBlockContents(data: FullOrBlindedBeaconBlockOrContents): data is BlockContents {
  return (data as BlockContents).kzgProofs !== undefined;
}

export function isSignedBlockContents(data: SignedBeaconBlock | SignedBlockContents): data is SignedBlockContents {
  return (data as SignedBlockContents).kzgProofs !== undefined;
}

export function isExecutionPayloadAndBlobsBundle(
  data: ExecutionPayload | ExecutionPayloadAndBlobsBundle
): data is ExecutionPayloadAndBlobsBundle {
  return (data as ExecutionPayloadAndBlobsBundle).blobsBundle !== undefined;
}
