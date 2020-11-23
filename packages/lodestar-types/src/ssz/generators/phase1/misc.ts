import {ContainerType} from "@chainsafe/ssz";
import * as t from "../../../types/phase1/types";
import {Phase1Generator} from "./interface";

export const AttestationData: Phase1Generator<ContainerType<t.AttestationData>> = (params, types) => {
  return new ContainerType({
    fields: {
      ...types.AttestationData.fields,
      shard: types.phase1.Shard,
      shardHeadRoot: types.Root,
      shardTransitionRoot: types.Root,
    },
  });
};

export const Attestation: Phase1Generator<ContainerType<t.Attestation>> = (params, types) => {
  return new ContainerType({
    fields: {
      ...types.Attestation.fields,
      data: types.phase1.AttestationData,
    },
  });
};

export const IndexedAttestation: Phase1Generator<ContainerType<t.IndexedAttestation>> = (params, types) => {
  return new ContainerType({
    fields: {
      ...types.IndexedAttestation.fields,
      data: types.phase1.AttestationData,
    },
  });
};

export const PendingAttestation: Phase1Generator<ContainerType<t.PendingAttestation>> = (params, types) => {
  return new ContainerType({
    fields: {
      ...types.PendingAttestation.fields,
      data: types.phase1.AttestationData,
      crosslinkSuccess: types.Boolean,
    },
  });
};

export const AttesterSlashing: Phase1Generator<ContainerType<t.AttesterSlashing>> = (params, types) => {
  return new ContainerType({
    fields: {
      ...types.AttesterSlashing.fields,
      attestation1: types.phase1.IndexedAttestation,
      attestation2: types.phase1.IndexedAttestation,
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
