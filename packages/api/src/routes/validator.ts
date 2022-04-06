import {ContainerType, fromHexString, toHexString, Type} from "@chainsafe/ssz";
import {ForkName} from "@chainsafe/lodestar-params";
import {
  allForks,
  altair,
  BLSPubkey,
  BLSSignature,
  CommitteeIndex,
  Epoch,
  phase0,
  Root,
  Slot,
  ssz,
  UintNum64,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";
import {
  RoutesData,
  ReturnTypes,
  ArrayOf,
  ContainerData,
  Schema,
  WithVersion,
  reqOnlyBody,
  ReqSerializers,
} from "../utils/index.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type BeaconCommitteeSubscription = {
  validatorIndex: ValidatorIndex;
  committeeIndex: number;
  committeesAtSlot: number;
  slot: Slot;
  isAggregator: boolean;
};

/**
 * From https://github.com/ethereum/beacon-APIs/pull/136
 */
export type SyncCommitteeSubscription = {
  validatorIndex: ValidatorIndex;
  syncCommitteeIndices: number[];
  untilEpoch: Epoch;
};

export type ProposerDuty = {
  slot: Slot;
  validatorIndex: ValidatorIndex;
  pubkey: BLSPubkey;
};

export type AttesterDuty = {
  // The validator's public key, uniquely identifying them
  pubkey: BLSPubkey;
  // Index of validator in validator registry
  validatorIndex: ValidatorIndex;
  committeeIndex: CommitteeIndex;
  // Number of validators in committee
  committeeLength: UintNum64;
  // Number of committees at the provided slot
  committeesAtSlot: UintNum64;
  // Index of validator in committee
  validatorCommitteeIndex: UintNum64;
  // The slot at which the validator must attest.
  slot: Slot;
};

/**
 * From https://github.com/ethereum/beacon-APIs/pull/134
 */
export type SyncDuty = {
  pubkey: BLSPubkey;
  /** Index of validator in validator registry. */
  validatorIndex: ValidatorIndex;
  /** The indices of the validator in the sync committee. */
  validatorSyncCommitteeIndices: number[];
};

export type Api = {
  /**
   * Get attester duties
   * Requests the beacon node to provide a set of attestation duties, which should be performed by validators, for a particular epoch.
   * Duties should only need to be checked once per epoch, however a chain reorganization (of > MIN_SEED_LOOKAHEAD epochs) could occur, resulting in a change of duties. For full safety, you should monitor head events and confirm the dependent root in this response matches:
   * - event.previous_duty_dependent_root when `compute_epoch_at_slot(event.slot) == epoch`
   * - event.current_duty_dependent_root when `compute_epoch_at_slot(event.slot) + 1 == epoch`
   * - event.block otherwise
   * The dependent_root value is `get_block_root_at_slot(state, compute_start_slot_at_epoch(epoch - 1) - 1)` or the genesis block root in the case of underflow.
   * @param epoch Should only be allowed 1 epoch ahead
   * @param requestBody An array of the validator indices for which to obtain the duties.
   * @returns any Success response
   * @throws ApiError
   */
  getAttesterDuties(
    epoch: Epoch,
    validatorIndices: ValidatorIndex[]
  ): Promise<{data: AttesterDuty[]; dependentRoot: Root}>;

  /**
   * Get block proposers duties
   * Request beacon node to provide all validators that are scheduled to propose a block in the given epoch.
   * Duties should only need to be checked once per epoch, however a chain reorganization could occur that results in a change of duties. For full safety, you should monitor head events and confirm the dependent root in this response matches:
   * - event.current_duty_dependent_root when `compute_epoch_at_slot(event.slot) == epoch`
   * - event.block otherwise
   * The dependent_root value is `get_block_root_at_slot(state, compute_start_slot_at_epoch(epoch) - 1)` or the genesis block root in the case of underflow.
   * @param epoch
   * @returns any Success response
   * @throws ApiError
   */
  getProposerDuties(epoch: Epoch): Promise<{data: ProposerDuty[]; dependentRoot: Root}>;

  getSyncCommitteeDuties(
    epoch: number,
    validatorIndices: ValidatorIndex[]
  ): Promise<{data: SyncDuty[]; dependentRoot: Root}>;

  /**
   * Produce a new block, without signature.
   * Requests a beacon node to produce a valid block, which can then be signed by a validator.
   * @param slot The slot for which the block should be proposed.
   * @param randaoReveal The validator's randao reveal value.
   * @param graffiti Arbitrary data validator wants to include in block.
   * @returns any Success response
   * @throws ApiError
   */
  produceBlock(slot: Slot, randaoReveal: BLSSignature, graffiti: string): Promise<{data: allForks.BeaconBlock}>;

  /**
   * Requests a beacon node to produce a valid block, which can then be signed by a validator.
   * Metadata in the response indicates the type of block produced, and the supported types of block
   * will be added to as forks progress.
   * @param slot The slot for which the block should be proposed.
   * @param randaoReveal The validator's randao reveal value.
   * @param graffiti Arbitrary data validator wants to include in block.
   * @returns any Success response
   * @throws ApiError
   */
  produceBlockV2(
    slot: Slot,
    randaoReveal: BLSSignature,
    graffiti: string
  ): Promise<{data: allForks.BeaconBlock; version: ForkName}>;

  /**
   * Produce an attestation data
   * Requests that the beacon node produce an AttestationData.
   * @param slot The slot for which an attestation data should be created.
   * @param committeeIndex The committee index for which an attestation data should be created.
   * @returns any Success response
   * @throws ApiError
   */
  produceAttestationData(index: CommitteeIndex, slot: Slot): Promise<{data: phase0.AttestationData}>;

  produceSyncCommitteeContribution(
    slot: Slot,
    subcommitteeIndex: number,
    beaconBlockRoot: Root
  ): Promise<{data: altair.SyncCommitteeContribution}>;

  /**
   * Get aggregated attestation
   * Aggregates all attestations matching given attestation data root and slot
   * @param attestationDataRoot HashTreeRoot of AttestationData that validator want's aggregated
   * @param slot
   * @returns any Returns aggregated `Attestation` object with same `AttestationData` root.
   * @throws ApiError
   */
  getAggregatedAttestation(attestationDataRoot: Root, slot: Slot): Promise<{data: phase0.Attestation}>;

  /**
   * Publish multiple aggregate and proofs
   * Verifies given aggregate and proofs and publishes them on appropriate gossipsub topic.
   * @param requestBody
   * @returns any Successful response
   * @throws ApiError
   */
  publishAggregateAndProofs(signedAggregateAndProofs: phase0.SignedAggregateAndProof[]): Promise<void>;

  publishContributionAndProofs(contributionAndProofs: altair.SignedContributionAndProof[]): Promise<void>;

  /**
   * Signal beacon node to prepare for a committee subnet
   * After beacon node receives this request,
   * search using discv5 for peers related to this subnet
   * and replace current peers with those ones if necessary
   * If validator `is_aggregator`, beacon node must:
   * - announce subnet topic subscription on gossipsub
   * - aggregate attestations received on that subnet
   *
   * @param requestBody
   * @returns any Slot signature is valid and beacon node has prepared the attestation subnet.
   *
   * Note that, we cannot be certain Beacon node will find peers for that subnet for various reasons,"
   *
   * @throws ApiError
   */
  prepareBeaconCommitteeSubnet(subscriptions: BeaconCommitteeSubscription[]): Promise<void>;

  prepareSyncCommitteeSubnets(subscriptions: SyncCommitteeSubscription[]): Promise<void>;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getAttesterDuties: {url: "/eth/v1/validator/duties/attester/:epoch", method: "POST"},
  getProposerDuties: {url: "/eth/v1/validator/duties/proposer/:epoch", method: "GET"},
  getSyncCommitteeDuties: {url: "/eth/v1/validator/duties/sync/:epoch", method: "POST"},
  produceBlock: {url: "/eth/v1/validator/blocks/:slot", method: "GET"},
  produceBlockV2: {url: "/eth/v2/validator/blocks/:slot", method: "GET"},
  produceAttestationData: {url: "/eth/v1/validator/attestation_data", method: "GET"},
  produceSyncCommitteeContribution: {url: "/eth/v1/validator/sync_committee_contribution", method: "GET"},
  getAggregatedAttestation: {url: "/eth/v1/validator/aggregate_attestation", method: "GET"},
  publishAggregateAndProofs: {url: "/eth/v1/validator/aggregate_and_proofs", method: "POST"},
  publishContributionAndProofs: {url: "/eth/v1/validator/contribution_and_proofs", method: "POST"},
  prepareBeaconCommitteeSubnet: {url: "/eth/v1/validator/beacon_committee_subscriptions", method: "POST"},
  prepareSyncCommitteeSubnets: {url: "/eth/v1/validator/sync_committee_subscriptions", method: "POST"},
};

/* eslint-disable @typescript-eslint/naming-convention */
export type ReqTypes = {
  getAttesterDuties: {params: {epoch: Epoch}; body: ValidatorIndex[]};
  getProposerDuties: {params: {epoch: Epoch}};
  getSyncCommitteeDuties: {params: {epoch: Epoch}; body: ValidatorIndex[]};
  produceBlock: {params: {slot: number}; query: {randao_reveal: string; grafitti: string}};
  produceBlockV2: {params: {slot: number}; query: {randao_reveal: string; grafitti: string}};
  produceAttestationData: {query: {slot: number; committee_index: number}};
  produceSyncCommitteeContribution: {query: {slot: number; subcommittee_index: number; beacon_block_root: string}};
  getAggregatedAttestation: {query: {attestation_data_root: string; slot: number}};
  publishAggregateAndProofs: {body: unknown};
  publishContributionAndProofs: {body: unknown};
  prepareBeaconCommitteeSubnet: {body: unknown};
  prepareSyncCommitteeSubnets: {body: unknown};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  const BeaconCommitteeSubscription = new ContainerType(
    {
      validatorIndex: ssz.ValidatorIndex,
      committeeIndex: ssz.CommitteeIndex,
      committeesAtSlot: ssz.Slot,
      slot: ssz.Slot,
      isAggregator: ssz.Boolean,
    },
    {jsonCase: "eth2"}
  );

  const SyncCommitteeSubscription = new ContainerType(
    {
      validatorIndex: ssz.ValidatorIndex,
      syncCommitteeIndices: ArrayOf(ssz.CommitteeIndex),
      untilEpoch: ssz.Epoch,
    },
    {jsonCase: "eth2"}
  );

  const produceBlock: ReqSerializers<Api, ReqTypes>["produceBlock"] = {
    writeReq: (slot, randaoReveal, grafitti) => ({
      params: {slot},
      query: {randao_reveal: toHexString(randaoReveal), grafitti},
    }),
    parseReq: ({params, query}) => [params.slot, fromHexString(query.randao_reveal), query.grafitti],
    schema: {
      params: {slot: Schema.UintRequired},
      query: {randao_reveal: Schema.StringRequired, grafitti: Schema.String},
    },
  };

  return {
    getAttesterDuties: {
      writeReq: (epoch, validatorIndexes) => ({params: {epoch}, body: validatorIndexes}),
      parseReq: ({params, body}) => [params.epoch, body],
      schema: {
        params: {epoch: Schema.UintRequired},
        body: Schema.UintArray,
      },
    },

    getProposerDuties: {
      writeReq: (epoch) => ({params: {epoch}}),
      parseReq: ({params}) => [params.epoch],
      schema: {
        params: {epoch: Schema.UintRequired},
      },
    },

    getSyncCommitteeDuties: {
      writeReq: (epoch, validatorIndexes) => ({params: {epoch}, body: validatorIndexes}),
      parseReq: ({params, body}) => [params.epoch, body],
      schema: {
        params: {epoch: Schema.UintRequired},
        body: Schema.UintArray,
      },
    },

    produceBlock: produceBlock,
    produceBlockV2: produceBlock,

    produceAttestationData: {
      writeReq: (index, slot) => ({query: {slot, committee_index: index}}),
      parseReq: ({query}) => [query.committee_index, query.slot],
      schema: {
        query: {slot: Schema.UintRequired, committee_index: Schema.UintRequired},
      },
    },

    produceSyncCommitteeContribution: {
      writeReq: (slot, index, root) => ({
        query: {slot, subcommittee_index: index, beacon_block_root: toHexString(root)},
      }),
      parseReq: ({query}) => [query.slot, query.subcommittee_index, fromHexString(query.beacon_block_root)],
      schema: {
        query: {
          slot: Schema.UintRequired,
          subcommittee_index: Schema.UintRequired,
          beacon_block_root: Schema.StringRequired,
        },
      },
    },

    getAggregatedAttestation: {
      writeReq: (root, slot) => ({query: {attestation_data_root: toHexString(root), slot}}),
      parseReq: ({query}) => [fromHexString(query.attestation_data_root), query.slot],
      schema: {
        query: {attestation_data_root: Schema.StringRequired, slot: Schema.UintRequired},
      },
    },

    publishAggregateAndProofs: reqOnlyBody(ArrayOf(ssz.phase0.SignedAggregateAndProof), Schema.ObjectArray),
    publishContributionAndProofs: reqOnlyBody(ArrayOf(ssz.altair.SignedContributionAndProof), Schema.ObjectArray),
    prepareBeaconCommitteeSubnet: reqOnlyBody(ArrayOf(BeaconCommitteeSubscription), Schema.ObjectArray),
    prepareSyncCommitteeSubnets: reqOnlyBody(ArrayOf(SyncCommitteeSubscription), Schema.ObjectArray),
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const WithDependentRoot = <T>(dataType: Type<T>) => new ContainerType({data: dataType, dependentRoot: ssz.Root});

  const AttesterDuty = new ContainerType(
    {
      pubkey: ssz.BLSPubkey,
      validatorIndex: ssz.ValidatorIndex,
      committeeIndex: ssz.CommitteeIndex,
      committeeLength: ssz.UintNum64,
      committeesAtSlot: ssz.UintNum64,
      validatorCommitteeIndex: ssz.UintNum64,
      slot: ssz.Slot,
    },
    {jsonCase: "eth2"}
  );

  const ProposerDuty = new ContainerType(
    {
      slot: ssz.Slot,
      validatorIndex: ssz.ValidatorIndex,
      pubkey: ssz.BLSPubkey,
    },
    {jsonCase: "eth2"}
  );

  const SyncDuty = new ContainerType(
    {
      pubkey: ssz.BLSPubkey,
      validatorIndex: ssz.ValidatorIndex,
      validatorSyncCommitteeIndices: ArrayOf(ssz.UintNum64),
    },
    {jsonCase: "eth2"}
  );

  return {
    getAttesterDuties: WithDependentRoot(ArrayOf(AttesterDuty)),
    getProposerDuties: WithDependentRoot(ArrayOf(ProposerDuty)),
    getSyncCommitteeDuties: WithDependentRoot(ArrayOf(SyncDuty)),
    produceBlock: ContainerData(ssz.phase0.BeaconBlock),
    produceBlockV2: WithVersion((fork: ForkName) => ssz[fork].BeaconBlock),
    produceAttestationData: ContainerData(ssz.phase0.AttestationData),
    produceSyncCommitteeContribution: ContainerData(ssz.altair.SyncCommitteeContribution),
    getAggregatedAttestation: ContainerData(ssz.phase0.Attestation),
  };
}
