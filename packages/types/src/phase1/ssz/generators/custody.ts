import {ByteVectorType, ContainerType, ListType, VectorType} from "@chainsafe/ssz";

import * as phase1 from "../../types";
import {Phase1Generator} from "./interface";

export const CustodyChunkChallenge: Phase1Generator<ContainerType<phase1.CustodyChunkChallenge>> = (
  params,
  altairTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      responderIndex: altairTypes.ValidatorIndex,
      shardTransition: phase1Types.ShardTransition,
      attestation: phase1Types.Attestation,
      dataIndex: altairTypes.Uint64,
      chunkIndex: altairTypes.Uint64,
    },
  });
};

export const CustodyChunkChallengeRecord: Phase1Generator<ContainerType<phase1.CustodyChunkChallengeRecord>> = (
  params,
  altairTypes
) => {
  return new ContainerType({
    fields: {
      challengeIndex: altairTypes.Uint64,
      challengerIndex: altairTypes.ValidatorIndex,
      responderIndex: altairTypes.ValidatorIndex,
      inclusionEpoch: altairTypes.Epoch,
      dataRoot: altairTypes.Root,
      chunkIndex: altairTypes.Uint64,
    },
  });
};

export const CustodyChunkResponse: Phase1Generator<ContainerType<phase1.CustodyChunkResponse>> = (
  params,
  altairTypes
) => {
  return new ContainerType({
    fields: {
      challengeIndex: altairTypes.Uint64,
      chunkIndex: altairTypes.Uint64,
      chunk: new ByteVectorType({
        length: params.BYTES_PER_CUSTODY_CHUNK,
      }),
      branch: new VectorType({
        elementType: altairTypes.Root,
        length: params.CUSTODY_RESPONSE_DEPTH + 1,
      }),
    },
  });
};

export const CustodySlashing: Phase1Generator<ContainerType<phase1.CustodySlashing>> = (
  params,
  altairTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      dataIndex: altairTypes.Uint64,
      malefactorIndex: altairTypes.ValidatorIndex,
      malefactorSecret: altairTypes.BLSSignature,
      whistleblowerIndex: altairTypes.ValidatorIndex,
      shardTransition: phase1Types.ShardTransition,
      attestation: phase1Types.Attestation,
      data: new ListType({
        elementType: altairTypes.Uint8,
        limit: params.MAX_SHARD_BLOCK_SIZE,
      }),
    },
  });
};

export const SignedCustodySlashing: Phase1Generator<ContainerType<phase1.SignedCustodySlashing>> = (
  params,
  altairTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      message: phase1Types.CustodySlashing,
      signature: altairTypes.BLSSignature,
    },
  });
};

export const CustodyKeyReveal: Phase1Generator<ContainerType<phase1.CustodyKeyReveal>> = (params, altairTypes) => {
  return new ContainerType({
    fields: {
      revealerIndex: altairTypes.ValidatorIndex,
      reveal: altairTypes.BLSSignature,
    },
  });
};

export const EarlyDerivedSecretReveal: Phase1Generator<ContainerType<phase1.EarlyDerivedSecretReveal>> = (
  params,
  altairTypes
) => {
  return new ContainerType({
    fields: {
      revealedIndex: altairTypes.ValidatorIndex,
      epoch: altairTypes.Epoch,
      reveal: altairTypes.BLSSignature,
      maskerIndex: altairTypes.ValidatorIndex,
      mask: altairTypes.Bytes32,
    },
  });
};
