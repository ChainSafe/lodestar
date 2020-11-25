import {ContainerType} from "@chainsafe/ssz";
import * as t from "../../../types/phase1/types";
import {Phase1Generator} from "./interface";

export const AttestationData: Phase1Generator<ContainerType<t.AttestationData>, "Shard"> = (
  params,
  types,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      ...types.AttestationData.fields,
      shard: phase1Types.Shard,
      shardHeadRoot: types.Root,
      shardTransitionRoot: types.Root,
    },
  });
};

export const Attestation: Phase1Generator<ContainerType<t.Attestation>, "AttestationData"> = (
  params,
  types,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      ...types.Attestation.fields,
      data: phase1Types.AttestationData,
    },
  });
};

export const IndexedAttestation: Phase1Generator<ContainerType<t.IndexedAttestation>, "AttestationData"> = (
  params,
  types,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      ...types.IndexedAttestation.fields,
      data: phase1Types.AttestationData,
    },
  });
};

export const PendingAttestation: Phase1Generator<ContainerType<t.PendingAttestation>, "AttestationData"> = (
  params,
  types,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      ...types.PendingAttestation.fields,
      data: phase1Types.AttestationData,
      crosslinkSuccess: types.Boolean,
    },
  });
};

export const AttesterSlashing: Phase1Generator<ContainerType<t.AttesterSlashing>, "IndexedAttestation"> = (
  params,
  types,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      ...types.AttesterSlashing.fields,
      attestation1: phase1Types.IndexedAttestation,
      attestation2: phase1Types.IndexedAttestation,
    },
  });
};

export const Validator: Phase1Generator<ContainerType<t.Validator>> = (params, types) => {
  return new ContainerType({
    fields: {
      ...types.Validator.fields,
      nextCustodySecretToReveal: types.Uint64,
      allCustodySecretsRevealedEpoch: types.Epoch,
    },
  });
};
