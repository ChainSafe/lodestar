import {BitVectorType, ContainerType, ListType, VectorType} from "@chainsafe/ssz";
import * as t from "../../../types/phase1/types";
import {Phase1Generator} from "./interface";

export const BeaconBlockBody: Phase1Generator<ContainerType<t.BeaconBlockBody>> = (params, types) => {
  return new ContainerType({
    fields: {
      ...types.BeaconBlockBody.fields,
      //override old types
      attestations: new ListType({
        elementType: types.phase1.Attestation,
        limit: params.MAX_ATTESTATIONS,
      }),
      attesterSlashings: new ListType({
        elementType: types.phase1.AttesterSlashing,
        limit: params.MAX_ATTESTER_SLASHINGS,
      }),
      //new properties
      chunkChallenges: new ListType({
        elementType: types.phase1.CustodyChunkChallenge,
        limit: params.phase1.MAX_CUSTODY_CHUNK_CHALLENGES,
      }),
      chunkChallengeResponses: new ListType({
        elementType: types.phase1.CustodyChunkResponse,
        limit: params.phase1.MAX_CUSTODY_CHUNK_CHALLENGE_RESPONSES,
      }),
      custodyKeyReveals: new ListType({
        elementType: types.phase1.CustodyKeyReveal,
        limit: params.phase1.MAX_CUSTODY_KEY_REVEALS,
      }),
      earlyDerivedSecretReveals: new ListType({
        elementType: types.phase1.EarlyDerivedSecretReveal,
        limit: params.phase1.MAX_EARLY_DERIVED_SECRET_REVEALS,
      }),
      custodySlashing: new ListType({
        elementType: types.phase1.SignedCustodySlashing,
        limit: params.phase1.MAX_CUSTODY_SLASHINGS,
      }),
      shardTransitions: new VectorType({
        elementType: types.phase1.ShardTransition,
        length: params.phase1.MAX_SHARDS,
      }),
      lightClientBits: new BitVectorType({length: params.phase1.LIGHT_CLIENT_COMMITTEE_SIZE}),
      lightClientSignature: types.BLSSignature,
    },
  });
};

export const BeaconBlock: Phase1Generator<ContainerType<t.BeaconBlock>> = (params, types) => {
  return new ContainerType({
    fields: {
      ...types.BeaconBlock.fields,
      body: types.phase1.BeaconBlockBody,
    },
  });
};

export const SignedBeaconBlock: Phase1Generator<ContainerType<t.SignedBeaconBlock>> = (params, types) => {
  return new ContainerType({
    fields: {
      ...types.SignedBeaconBlock.fields,
      message: types.phase1.BeaconBlock,
    },
  });
};

export const BeaconState: Phase1Generator<ContainerType<t.BeaconState>> = (params, types) => {
  return new ContainerType({
    fields: {
      ...types.BeaconState.fields,
      validator: types.phase1.Validator,
      previousEpochAttestations: new ListType({
        elementType: types.phase1.PendingAttestation,
        limit: params.MAX_ATTESTATIONS * params.SLOTS_PER_EPOCH,
      }),
      currentEpochAttestations: new ListType({
        elementType: types.phase1.PendingAttestation,
        limit: params.MAX_ATTESTATIONS * params.SLOTS_PER_EPOCH,
      }),
      //phase1
      currentEpochStartShard: types.phase1.Shard,
      shardStates: new ListType({
        elementType: types.phase1.ShardState,
        limit: params.phase1.MAX_SHARDS,
      }),
      onlineCountdown: new ListType({
        elementType: types.phase1.OnlineEpochs,
        limit: params.VALIDATOR_REGISTRY_LIMIT,
      }),
      currentLightCommittee: types.phase1.CompactCommittee,
      nextLightCommittee: types.phase1.CompactCommittee,
      exposedDerivedSecrets: new VectorType({
        elementType: new ListType({
          elementType: types.ValidatorIndex,
          limit: params.phase1.MAX_EARLY_DERIVED_SECRET_REVEALS * params.SLOTS_PER_EPOCH,
        }),
        length: params.phase1.EARLY_DERIVED_SECRET_PENALTY_MAX_FUTURE_EPOCHS,
      }),
      custodyChunkChallengeRecords: new ListType({
        elementType: types.phase1.CustodyChunkChallengeRecord,
        limit: params.phase1.MAX_CUSTODY_CHUNK_CHALLENGE_RECORDS,
      }),
      custodyChunkChallengeIndex: types.Uint64,
    },
  });
};
