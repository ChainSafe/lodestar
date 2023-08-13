import {ChainForkConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {allForks, phase0, Root, isBlindedBeaconBlock, isBlindedBlobSidecar, deneb, ssz} from "@lodestar/types";

import {executionPayloadToPayloadHeader} from "./execution.js";

export function blindedOrFullBlockHashTreeRoot(
  config: ChainForkConfig,
  blindedOrFull: allForks.FullOrBlindedBeaconBlock
): Root {
  return isBlindedBeaconBlock(blindedOrFull)
    ? // Blinded
      config.getBlindedForkTypes(blindedOrFull.slot).BeaconBlock.hashTreeRoot(blindedOrFull)
    : // Full
      config.getForkTypes(blindedOrFull.slot).BeaconBlock.hashTreeRoot(blindedOrFull);
}

export function blindedOrFullBlobSidecarHashTreeRoot(
  config: ChainForkConfig,
  blindedOrFull: allForks.FullOrBlindedBlobSidecar
): Root {
  return isBlindedBlobSidecar(blindedOrFull)
    ? // Blinded
      config.getBlobsForkTypes(blindedOrFull.slot).BlindedBlobSidecar.hashTreeRoot(blindedOrFull)
    : // Full
      config.getBlobsForkTypes(blindedOrFull.slot).BlobSidecar.hashTreeRoot(blindedOrFull);
}

export function blindedOrFullBlockToHeader(
  config: ChainForkConfig,
  blindedOrFull: allForks.FullOrBlindedBeaconBlock
): phase0.BeaconBlockHeader {
  const bodyRoot = isBlindedBeaconBlock(blindedOrFull)
    ? // Blinded
      config.getBlindedForkTypes(blindedOrFull.slot).BeaconBlockBody.hashTreeRoot(blindedOrFull.body)
    : // Full
      config.getForkTypes(blindedOrFull.slot).BeaconBlockBody.hashTreeRoot(blindedOrFull.body);

  return {
    slot: blindedOrFull.slot,
    proposerIndex: blindedOrFull.proposerIndex,
    parentRoot: blindedOrFull.parentRoot,
    stateRoot: blindedOrFull.stateRoot,
    bodyRoot,
  };
}

export function beaconBlockToBlinded(
  config: ChainForkConfig,
  block: allForks.AllForksExecution["BeaconBlock"]
): allForks.BlindedBeaconBlock {
  const fork = config.getForkName(block.slot);
  const executionPayloadHeader = executionPayloadToPayloadHeader(ForkSeq[fork], block.body.executionPayload);
  const blindedBlock = {...block, body: {...block.body, executionPayloadHeader}} as allForks.BlindedBeaconBlock;
  return blindedBlock;
}

export function blobSidecarsToBlinded(blobSidecars: deneb.BlobSidecars): deneb.BlindedBlobSidecars {
  return blobSidecars.map((blobSidecar) => {
    const blobRoot = ssz.deneb.Blob.hashTreeRoot(blobSidecar.blob);
    return {...blobSidecar, blobRoot} as deneb.BlindedBlobSidecar;
  });
}

export function signedBlindedBlockToFull(
  signedBlindedBlock: allForks.SignedBlindedBeaconBlock,
  executionPayload: allForks.ExecutionPayload | null
): allForks.SignedBeaconBlock {
  const signedBlock = {
    ...signedBlindedBlock,
    message: {
      ...signedBlindedBlock.message,
      body: {
        ...signedBlindedBlock.message.body,
        // state transition doesn't handle null value for executionPayload in pre-bellatrix blocks
        executionPayload: executionPayload ?? undefined,
      },
    },
  } as allForks.SignedBeaconBlock;

  // state transition can't seem to handle executionPayloadHeader presense in merge block
  // so just delete the extra field we don't require
  delete (signedBlock.message.body as {executionPayloadHeader?: allForks.ExecutionPayloadHeader})
    .executionPayloadHeader;
  return signedBlock;
}

export function signedBlindedBlobSidecarsToFull(
  signedBlindedBlobSidecars: deneb.SignedBlindedBlobSidecars,
  blobs: deneb.Blobs
): deneb.SignedBlobSidecars {
  const signedBlobSidecars = signedBlindedBlobSidecars.map((signedBlindedBlobSidecar, index) => {
    const signedBlobSidecar = {
      ...signedBlindedBlobSidecar,
      message: {...signedBlindedBlobSidecar.message, blob: blobs[index]},
    };
    delete (signedBlobSidecar.message as {blobRoot?: deneb.BlindedBlob}).blobRoot;
    return signedBlobSidecar;
  });
  return signedBlobSidecars;
}
