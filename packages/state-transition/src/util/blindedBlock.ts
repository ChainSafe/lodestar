import {ChainForkConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {
  allForks,
  phase0,
  Root,
  deneb,
  ssz,
  isBlindedBeaconBlock,
  isBlindedBlobSidecar,
  isSignedBlindedBlockContents,
  isExecutionPayloadAndBlobsBundle,
} from "@lodestar/types";

import {executionPayloadToPayloadHeader} from "./execution.js";

type ParsedSignedBlindedBlockOrContents = {
  signedBlindedBlock: allForks.SignedBlindedBeaconBlock;
  signedBlindedBlobSidecars: deneb.SignedBlindedBlobSidecars | null;
};

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

export function parseSignedBlindedBlockOrContents(
  signedBlindedBlockOrContents: allForks.SignedBlindedBeaconBlockOrContents
): ParsedSignedBlindedBlockOrContents {
  if (isSignedBlindedBlockContents(signedBlindedBlockOrContents)) {
    const signedBlindedBlock = signedBlindedBlockOrContents.signedBlindedBlock;
    const signedBlindedBlobSidecars = signedBlindedBlockOrContents.signedBlindedBlobSidecars;
    return {signedBlindedBlock, signedBlindedBlobSidecars};
  } else {
    return {signedBlindedBlock: signedBlindedBlockOrContents, signedBlindedBlobSidecars: null};
  }
}

export function parseExecutionPayloadAndBlobsBundle(
  data: allForks.ExecutionPayload | allForks.ExecutionPayloadAndBlobsBundle
): {executionPayload: allForks.ExecutionPayload; blobsBundle: deneb.BlobsBundle | null} {
  if (isExecutionPayloadAndBlobsBundle(data)) {
    return data;
  } else {
    return {
      executionPayload: data,
      blobsBundle: null,
    };
  }
}

export function reconstructFullBlockOrContents(
  {signedBlindedBlock, signedBlindedBlobSidecars}: ParsedSignedBlindedBlockOrContents,
  {executionPayload, blobs}: {executionPayload: allForks.ExecutionPayload | null; blobs: deneb.Blobs | null}
): allForks.SignedBeaconBlockOrContents {
  const signedBlock = signedBlindedBlockToFull(signedBlindedBlock, executionPayload);

  if (signedBlindedBlobSidecars !== null) {
    if (executionPayload === null) {
      throw Error("Missing locally produced executionPayload for deneb+ publishBlindedBlock");
    }

    if (blobs === null) {
      throw Error("Missing blobs from the local execution cache");
    }
    if (blobs.length !== signedBlindedBlobSidecars.length) {
      throw Error(
        `Length mismatch signedBlindedBlobSidecars=${signedBlindedBlobSidecars.length} blobs=${blobs.length}`
      );
    }
    const signedBlobSidecars = signedBlindedBlobSidecarsToFull(signedBlindedBlobSidecars, blobs);

    return {signedBlock, signedBlobSidecars} as allForks.SignedBeaconBlockOrContents;
  } else {
    return signedBlock as allForks.SignedBeaconBlockOrContents;
  }
}
