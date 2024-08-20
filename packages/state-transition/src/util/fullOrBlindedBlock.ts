/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import {ChainForkConfig} from "@lodestar/config";
import {ForkName, ForkSeq} from "@lodestar/params";
import {
  Root,
  isExecutionPayloadAndBlobsBundle,
  BeaconBlock,
  BeaconBlockHeader,
  SignedBeaconBlock,
  ExecutionPayload,
  ExecutionPayloadAndBlobsBundle,
  BlobsBundle,
  SignedBeaconBlockOrContents,
  Contents,
  SignedBlindedBeaconBlock,
  BlindedBeaconBlock,
  ExecutionPayloadHeader,
  isBlindedSignedBeaconBlock,
} from "@lodestar/types";

import {executionPayloadToPayloadHeader} from "./execution.js";

export function isSignedBlock(
  block: BeaconBlock | BlindedBeaconBlock | SignedBeaconBlock | SignedBlindedBeaconBlock
): block is SignedBeaconBlock | SignedBlindedBeaconBlock {
  return !!(block as SignedBeaconBlock).signature;
}

export function isBlindedBlock(
  block: BeaconBlock | BlindedBeaconBlock | SignedBeaconBlock | SignedBlindedBeaconBlock
): block is BlindedBeaconBlock | SignedBlindedBeaconBlock {
  if (isSignedBlock(block)) {
    return !!(block as SignedBlindedBeaconBlock).message.body.executionPayloadHeader;
  }
  return !!(block as BlindedBeaconBlock).body.executionPayloadHeader;
}

export function blindedOrFullBlockBodyHashTreeRoot(
  config: ChainForkConfig,
  blindedOrFull: BeaconBlock | BlindedBeaconBlock
): Root {
  return isBlindedBlock(blindedOrFull)
    ? // Blinded
      config.getExecutionForkTypes(blindedOrFull.slot).BlindedBeaconBlockBody.hashTreeRoot(blindedOrFull.body)
    : // Full
      config.getForkTypes(blindedOrFull.slot).BeaconBlockBody.hashTreeRoot(blindedOrFull.body);
}

export function blindedOrFullBlockHashTreeRoot(
  config: ChainForkConfig,
  blindedOrFull: BeaconBlock | BlindedBeaconBlock
): Root {
  return isBlindedBlock(blindedOrFull)
    ? // Blinded
      config.getExecutionForkTypes(blindedOrFull.slot).BlindedBeaconBlock.hashTreeRoot(blindedOrFull)
    : // Full
      config.getForkTypes(blindedOrFull.slot).BeaconBlock.hashTreeRoot(blindedOrFull);
}

export function blindedOrFullSignedBlockHashTreeRoot(
  config: ChainForkConfig,
  blindedOrFull: SignedBeaconBlock | SignedBlindedBeaconBlock
): Root {
  return isBlindedSignedBeaconBlock(blindedOrFull)
    ? // Blinded
      config.getExecutionForkTypes(blindedOrFull.message.slot).SignedBlindedBeaconBlock.hashTreeRoot(blindedOrFull)
    : // Full
      config.getForkTypes(blindedOrFull.message.slot).SignedBeaconBlock.hashTreeRoot(blindedOrFull);
}

export function blindedOrFullBlockToHeader(
  config: ChainForkConfig,
  blindedOrFull: BeaconBlock | BlindedBeaconBlock
): BeaconBlockHeader {
  const bodyRoot = isBlindedBlock(blindedOrFull)
    ? // Blinded
      config.getExecutionForkTypes(blindedOrFull.slot).BlindedBeaconBlockBody.hashTreeRoot(blindedOrFull.body)
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

export function fullOrBlindedBlockToBlinded(
  config: ChainForkConfig,
  block: BeaconBlock | BlindedBeaconBlock
): BlindedBeaconBlock {
  const forkSeq = config.getForkSeq(block.slot);
  if (isBlindedBlock(block) || forkSeq < ForkSeq.bellatrix) {
    return block as BlindedBeaconBlock;
  }
  const blinded: BlindedBeaconBlock = {
    ...block,
    body: {
      randaoReveal: block.body.randaoReveal,
      eth1Data: block.body.eth1Data,
      graffiti: block.body.graffiti,
      proposerSlashings: block.body.proposerSlashings,
      attesterSlashings: block.body.attesterSlashings,
      attestations: block.body.attestations,
      deposits: block.body.deposits,
      voluntaryExits: block.body.voluntaryExits,
      syncAggregate: (block as BeaconBlock<ForkName.bellatrix>).body.syncAggregate,
      executionPayloadHeader: executionPayloadToPayloadHeader(
        forkSeq,
        (block as BeaconBlock<ForkName.bellatrix>).body.executionPayload
      ),
    },
  };

  if (forkSeq >= ForkSeq.capella) {
    (blinded as BlindedBeaconBlock<ForkName.capella>).body.blsToExecutionChanges = (
      block as BeaconBlock<ForkName.capella>
    ).body.blsToExecutionChanges;
  }

  if (forkSeq >= ForkSeq.deneb) {
    (blinded as BlindedBeaconBlock<ForkName.deneb>).body.blobKzgCommitments = (
      block as BeaconBlock<ForkName.deneb>
    ).body.blobKzgCommitments;
  }

  return blinded;
}

export function fullOrBlindedSignedBlockToBlinded(
  config: ChainForkConfig,
  signedBlock: SignedBeaconBlock | SignedBlindedBeaconBlock
): SignedBlindedBeaconBlock {
  return {
    message: fullOrBlindedBlockToBlinded(config, signedBlock.message),
    signature: signedBlock.signature,
  };
}

// TODO: (@matthewkeil) not the same as blindedOrFullBlockToFull in beacon-node. consider merging?
export function signedBlindedBlockToFull(
  signedBlindedBlock: SignedBlindedBeaconBlock,
  executionPayload: ExecutionPayload | null
): SignedBeaconBlock {
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
  } else {
    return {
      executionPayload: data,
      blobsBundle: null,
    };
  }
}

export function reconstructFullBlockOrContents(
  signedBlindedBlock: SignedBlindedBeaconBlock,
  {
    executionPayload,
    contents,
  }: {
    executionPayload: ExecutionPayload | null;
    contents: Contents | null;
  }
): SignedBeaconBlockOrContents {
  const signedBlock = signedBlindedBlockToFull(signedBlindedBlock, executionPayload);

  if (contents !== null) {
    if (executionPayload === null) {
      throw Error("Missing locally produced executionPayload for deneb+ publishBlindedBlock");
    }

    return {signedBlock, ...contents} as SignedBeaconBlockOrContents;
  } else {
    return signedBlock as SignedBeaconBlockOrContents;
  }
}
