import {
  FullOrBlindedBeaconBlock,
  FullOrBlindedSignedBeaconBlock,
  FullOrBlindedExecutionPayload,
  ExecutionPayloadHeader,
  FullOrBlindedBlobSidecar,
  FullOrBlindedSignedBlobSidecar,
} from "../allForks/types.js";
import {ts as bellatrix} from "../bellatrix/index.js";
import {ts as deneb} from "../deneb/index.js";
import {ts as allForks} from "../allForks/index.js";

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

export function isBlindedBlobSidecar(blob: FullOrBlindedBlobSidecar): blob is deneb.BlindedBlobSidecar {
  return (blob as deneb.BlindedBlobSidecar).blobRoot !== undefined;
}

export function isBlindedSignedBlobSidecar(
  blob: FullOrBlindedSignedBlobSidecar
): blob is deneb.SignedBlindedBlobSidecar {
  return (blob as deneb.SignedBlindedBlobSidecar).message.blobRoot !== undefined;
}

export function isBlockContents(data: allForks.BeaconBlock | allForks.BlockContents): data is allForks.BlockContents {
  return (data as allForks.BlockContents).blobSidecars !== undefined;
}

export function isSignedBlockContents(
  data: allForks.SignedBeaconBlock | allForks.SignedBlockContents
): data is allForks.SignedBlockContents {
  return (data as allForks.SignedBlockContents).signedBlobSidecars !== undefined;
}

export function isBlindedBlockContents(
  data: allForks.BlindedBeaconBlock | allForks.BlindedBlockContents
): data is allForks.BlindedBlockContents {
  return (data as allForks.BlindedBlockContents).blindedBlobSidecars !== undefined;
}

export function isSignedBlindedBlockContents(
  data: allForks.SignedBlindedBeaconBlock | allForks.SignedBlindedBlockContents
): data is allForks.SignedBlindedBlockContents {
  return (data as allForks.SignedBlindedBlockContents).signedBlindedBlobSidecars !== undefined;
}
