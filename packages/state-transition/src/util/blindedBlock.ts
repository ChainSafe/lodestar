import {ChainForkConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {allForks, phase0, Root, deneb, isBlindedBeaconBlock, isExecutionPayloadAndBlobsBundle} from "@lodestar/types";

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
  signedBlindedBlock: allForks.SignedBlindedBeaconBlock,
  {
    executionPayload,
    contents,
  }: {
    executionPayload: allForks.ExecutionPayload | null;
    contents: deneb.Contents | null;
  }
): allForks.SignedBeaconBlockOrContents {
  const signedBlock = signedBlindedBlockToFull(signedBlindedBlock, executionPayload);

  if (contents !== null) {
    if (executionPayload === null) {
      throw Error("Missing locally produced executionPayload for deneb+ publishBlindedBlock");
    }

    return {signedBlock, ...contents} as allForks.SignedBeaconBlockOrContents;
  } else {
    return signedBlock as allForks.SignedBeaconBlockOrContents;
  }
}
