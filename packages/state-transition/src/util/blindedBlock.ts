import {ChainForkConfig} from "@lodestar/config";
import {
  ForkName,
  ForkPostBellatrix,
  ForkPostDeneb,
  ForkPreGloas,
  ForkSeq,
  isForkPostBellatrix,
  isForkPostDeneb,
} from "@lodestar/params";
import {
  BeaconBlock,
  BeaconBlockHeader,
  BlindedBeaconBlock,
  BlobsBundle,
  ExecutionPayload,
  ExecutionPayloadAndBlobsBundle,
  ExecutionPayloadHeader,
  Root,
  SignedBeaconBlock,
  SignedBlindedBeaconBlock,
  SignedBlockContents,
  isBlindedBeaconBlock,
  isExecutionPayloadAndBlobsBundle,
} from "@lodestar/types";
import {executionPayloadToPayloadHeader} from "./execution.js";

export function blindedOrFullBlockHashTreeRoot(
  config: ChainForkConfig,
  blindedOrFull: BeaconBlock | BlindedBeaconBlock
): Root {
  return isBlindedBeaconBlock(blindedOrFull)
    ? // Blinded
      config
        .getPostBellatrixForkTypes(blindedOrFull.slot)
        .BlindedBeaconBlock.hashTreeRoot(blindedOrFull)
    : // Full
      config
        .getForkTypes(blindedOrFull.slot)
        .BeaconBlock.hashTreeRoot(blindedOrFull);
}

export function blindedOrFullBlockToHeader(
  config: ChainForkConfig,
  blindedOrFull: BeaconBlock | BlindedBeaconBlock
): BeaconBlockHeader {
  const bodyRoot = isBlindedBeaconBlock(blindedOrFull)
    ? // Blinded
      config
        .getPostBellatrixForkTypes(blindedOrFull.slot)
        .BlindedBeaconBlockBody.hashTreeRoot(blindedOrFull.body)
    : // Full
      config
        .getForkTypes(blindedOrFull.slot)
        .BeaconBlockBody.hashTreeRoot(blindedOrFull.body);

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
  block: BeaconBlock<ForkPostBellatrix & ForkPreGloas>
): BlindedBeaconBlock {
  const fork = config.getForkName(block.slot);
  const executionPayloadHeader = executionPayloadToPayloadHeader(ForkSeq[fork], block.body.executionPayload);
  const blindedBlock: BlindedBeaconBlock = {...block, body: {...block.body, executionPayloadHeader}};
  return blindedBlock;
}

export function signedBeaconBlockToBlinded(
  config: ChainForkConfig,
  signedBlock: SignedBeaconBlock<ForkPostBellatrix & ForkPreGloas>
): SignedBlindedBeaconBlock {
  return {
    message: beaconBlockToBlinded(config, signedBlock.message),
    signature: signedBlock.signature,
  };
}

export function signedBlindedBlockToFull(
  fork: ForkName,
  signedBlindedBlock: SignedBlindedBeaconBlock,
  executionPayload: ExecutionPayload | null
): SignedBeaconBlock {
  if (isForkPostBellatrix(fork) && executionPayload === null) {
    throw Error("Missing executionPayload to reconstruct post-bellatrix full block");
  }

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
  } as SignedBeaconBlock;

  // state transition can't seem to handle executionPayloadHeader presense in merge block
  // so just delete the extra field we don't require
  delete (signedBlock.message.body as {executionPayloadHeader?: ExecutionPayloadHeader}).executionPayloadHeader;
  return signedBlock;
}

export function parseExecutionPayloadAndBlobsBundle(data: ExecutionPayload | ExecutionPayloadAndBlobsBundle): {
  executionPayload: ExecutionPayload;
  blobsBundle: BlobsBundle | null;
} {
  if (isExecutionPayloadAndBlobsBundle(data)) {
    return data;
  }
  return {
    executionPayload: data,
    blobsBundle: null,
  };
}

export function reconstructSignedBlockContents(
  fork: ForkName,
  signedBlindedBlock: SignedBlindedBeaconBlock,
  executionPayload: ExecutionPayload | null,
  blobsBundle: BlobsBundle | null
): SignedBlockContents {
  const signedBlock = signedBlindedBlockToFull(fork, signedBlindedBlock, executionPayload);

  if (isForkPostDeneb(fork)) {
    if (blobsBundle === null) {
      throw Error("Missing blobs bundle to reconstruct post-deneb block contents");
    }
    return {
      signedBlock: signedBlock as SignedBeaconBlock<ForkPostDeneb>,
      kzgProofs: blobsBundle.proofs,
      blobs: blobsBundle.blobs,
    };
  }
  return {signedBlock};
}
