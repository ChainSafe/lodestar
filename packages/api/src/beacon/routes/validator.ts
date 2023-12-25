import {ContainerType, fromHexString, toHexString, Type} from "@chainsafe/ssz";
import {ForkName, ForkBlobs, isForkBlobs, isForkExecution, ForkPreBlobs, ForkExecution} from "@lodestar/params";
import {
  allForks,
  altair,
  BLSPubkey,
  BLSSignature,
  CommitteeIndex,
  Epoch,
  phase0,
  bellatrix,
  Root,
  Slot,
  ssz,
  UintNum64,
  ValidatorIndex,
  RootHex,
  StringType,
  SubcommitteeIndex,
  Wei,
  Gwei,
  ProducedBlockSource,
} from "@lodestar/types";
import {ApiClientResponse} from "../../interfaces.js";
import {HttpStatusCode} from "../../utils/client/httpStatusCode.js";
import {
  RoutesData,
  ReturnTypes,
  ArrayOf,
  Schema,
  WithVersion,
  WithBlockValues,
  reqOnlyBody,
  ReqSerializers,
  jsonType,
  ContainerDataExecutionOptimistic,
  ContainerData,
  TypeJson,
} from "../../utils/index.js";
import {fromU64Str, fromGraffitiHex, toU64Str, U64Str, toGraffitiHex} from "../../utils/serdes.js";
import {allForksBlockContentsResSerializer} from "../../utils/routes.js";
import {ExecutionOptimistic} from "./beacon/block.js";

export enum BuilderSelection {
  BuilderAlways = "builderalways",
  MaxProfit = "maxprofit",
  /** Only activate builder flow for DVT block proposal protocols */
  BuilderOnly = "builderonly",
  /** Only builds execution block*/
  ExecutionOnly = "executiononly",
}

export type ExtraProduceBlockOps = {
  feeRecipient?: string;
  builderSelection?: BuilderSelection;
  // precise value  isn't required because super high values will be treated as always builder prefered
  // and hence UintNum64 is sufficient. If this param is present, builderSelection will be infered to
  // be of maxprofit (unless explicity provided) with this %age boost factor applied to the builder values
  builderBoostFactor?: UintNum64;
  strictFeeRecipientCheck?: boolean;
  blindedLocal?: boolean;
};

export type ProduceBlockOrContentsRes = {executionPayloadValue: Wei; consensusBlockValue: Gwei} & (
  | {data: allForks.BeaconBlock; version: ForkPreBlobs}
  | {data: allForks.BlockContents; version: ForkBlobs}
);
export type ProduceBlindedBlockRes = {executionPayloadValue: Wei; consensusBlockValue: Gwei} & {
  data: allForks.BlindedBeaconBlock;
  version: ForkExecution;
};

export type ProduceFullOrBlindedBlockOrContentsRes = {executionPayloadSource: ProducedBlockSource} & (
  | (ProduceBlockOrContentsRes & {executionPayloadBlinded: false})
  | (ProduceBlindedBlockRes & {executionPayloadBlinded: true})
);

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

/**
 * The types used here are string instead of ssz based because the use of proposer data
 * is just validator --> beacon json api call for `beaconProposerCache` cache update.
 */
export type ProposerPreparationData = {
  validatorIndex: string;
  feeRecipient: string;
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

/**
 * From https://github.com/ethereum/beacon-APIs/pull/224
 */
export type BeaconCommitteeSelection = {
  /** Index of the validator */
  validatorIndex: ValidatorIndex;
  /** The slot at which a validator is assigned to attest */
  slot: Slot;
  /** The `slot_signature` calculated by the validator for the upcoming attestation slot */
  selectionProof: BLSSignature;
};

/**
 * From https://github.com/ethereum/beacon-APIs/pull/224
 */
export type SyncCommitteeSelection = {
  /** Index of the validator */
  validatorIndex: ValidatorIndex;
  /** The slot at which validator is assigned to produce a sync committee contribution */
  slot: Slot;
  /** SubcommitteeIndex to which the validator is assigned */
  subcommitteeIndex: SubcommitteeIndex;
  /** The `slot_signature` calculated by the validator for the upcoming sync committee slot */
  selectionProof: BLSSignature;
};

export type LivenessResponseData = {
  index: ValidatorIndex;
  isLive: boolean;
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
  ): Promise<
    ApiClientResponse<
      {[HttpStatusCode.OK]: {data: AttesterDuty[]; executionOptimistic: ExecutionOptimistic; dependentRoot: RootHex}},
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.SERVICE_UNAVAILABLE
    >
  >;

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
  getProposerDuties(
    epoch: Epoch
  ): Promise<
    ApiClientResponse<
      {[HttpStatusCode.OK]: {data: ProposerDuty[]; executionOptimistic: ExecutionOptimistic; dependentRoot: RootHex}},
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.SERVICE_UNAVAILABLE
    >
  >;

  getSyncCommitteeDuties(
    epoch: number,
    validatorIndices: ValidatorIndex[]
  ): Promise<
    ApiClientResponse<
      {[HttpStatusCode.OK]: {data: SyncDuty[]; executionOptimistic: ExecutionOptimistic}},
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.SERVICE_UNAVAILABLE
    >
  >;

  /**
   * Produce a new block, without signature.
   * Requests a beacon node to produce a valid block, which can then be signed by a validator.
   * @param slot The slot for which the block should be proposed.
   * @param randaoReveal The validator's randao reveal value.
   * @param graffiti Arbitrary data validator wants to include in block.
   * @returns any Success response
   * @throws ApiError
   */
  produceBlock(
    slot: Slot,
    randaoReveal: BLSSignature,
    graffiti: string
  ): Promise<
    ApiClientResponse<
      {[HttpStatusCode.OK]: {data: allForks.BeaconBlock}},
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.SERVICE_UNAVAILABLE
    >
  >;

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
  ): Promise<
    ApiClientResponse<
      {[HttpStatusCode.OK]: ProduceBlockOrContentsRes},
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.SERVICE_UNAVAILABLE
    >
  >;

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
  produceBlockV3(
    slot: Slot,
    randaoReveal: BLSSignature,
    graffiti: string,
    skipRandaoVerification?: boolean,
    opts?: ExtraProduceBlockOps
  ): Promise<
    ApiClientResponse<
      {
        [HttpStatusCode.OK]: ProduceFullOrBlindedBlockOrContentsRes;
      },
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.SERVICE_UNAVAILABLE
    >
  >;

  produceBlindedBlock(
    slot: Slot,
    randaoReveal: BLSSignature,
    graffiti: string
  ): Promise<
    ApiClientResponse<
      {
        [HttpStatusCode.OK]: ProduceBlindedBlockRes;
      },
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.SERVICE_UNAVAILABLE
    >
  >;

  /**
   * Produce an attestation data
   * Requests that the beacon node produce an AttestationData.
   * @param slot The slot for which an attestation data should be created.
   * @param committeeIndex The committee index for which an attestation data should be created.
   * @returns any Success response
   * @throws ApiError
   */
  produceAttestationData(
    index: CommitteeIndex,
    slot: Slot
  ): Promise<
    ApiClientResponse<
      {[HttpStatusCode.OK]: {data: phase0.AttestationData}},
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.SERVICE_UNAVAILABLE
    >
  >;

  produceSyncCommitteeContribution(
    slot: Slot,
    subcommitteeIndex: number,
    beaconBlockRoot: Root
  ): Promise<
    ApiClientResponse<
      {[HttpStatusCode.OK]: {data: altair.SyncCommitteeContribution}},
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.SERVICE_UNAVAILABLE
    >
  >;

  /**
   * Get aggregated attestation
   * Aggregates all attestations matching given attestation data root and slot
   * @param attestationDataRoot HashTreeRoot of AttestationData that validator want's aggregated
   * @param slot
   * @returns any Returns aggregated `Attestation` object with same `AttestationData` root.
   * @throws ApiError
   */
  getAggregatedAttestation(
    attestationDataRoot: Root,
    slot: Slot
  ): Promise<
    ApiClientResponse<
      {[HttpStatusCode.OK]: {data: phase0.Attestation}},
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.NOT_FOUND
    >
  >;

  /**
   * Publish multiple aggregate and proofs
   * Verifies given aggregate and proofs and publishes them on appropriate gossipsub topic.
   * @param requestBody
   * @returns any Successful response
   * @throws ApiError
   */
  publishAggregateAndProofs(
    signedAggregateAndProofs: phase0.SignedAggregateAndProof[]
  ): Promise<ApiClientResponse<{[HttpStatusCode.OK]: void}, HttpStatusCode.BAD_REQUEST>>;

  publishContributionAndProofs(
    contributionAndProofs: altair.SignedContributionAndProof[]
  ): Promise<ApiClientResponse<{[HttpStatusCode.OK]: void}, HttpStatusCode.BAD_REQUEST>>;

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
  prepareBeaconCommitteeSubnet(
    subscriptions: BeaconCommitteeSubscription[]
  ): Promise<
    ApiClientResponse<{[HttpStatusCode.OK]: void}, HttpStatusCode.BAD_REQUEST | HttpStatusCode.SERVICE_UNAVAILABLE>
  >;

  prepareSyncCommitteeSubnets(
    subscriptions: SyncCommitteeSubscription[]
  ): Promise<
    ApiClientResponse<{[HttpStatusCode.OK]: void}, HttpStatusCode.BAD_REQUEST | HttpStatusCode.SERVICE_UNAVAILABLE>
  >;

  prepareBeaconProposer(
    proposers: ProposerPreparationData[]
  ): Promise<ApiClientResponse<{[HttpStatusCode.OK]: void}, HttpStatusCode.BAD_REQUEST>>;

  /**
   * Determine if a distributed validator has been selected to aggregate attestations
   *
   * This endpoint is implemented by a distributed validator middleware client to exchange
   * partial beacon committee selection proofs for combined/aggregated selection proofs to allow
   * a validator client to correctly determine if one of its validators has been selected to
   * perform an aggregation duty in this slot.
   *
   * Note that this endpoint is not implemented by the beacon node and will return a 501 error
   *
   * @param requestBody An array of partial beacon committee selection proofs
   * @returns An array of threshold aggregated beacon committee selection proofs
   * @throws ApiError
   */
  submitBeaconCommitteeSelections(
    selections: BeaconCommitteeSelection[]
  ): Promise<
    ApiClientResponse<
      {[HttpStatusCode.OK]: {data: BeaconCommitteeSelection[]}},
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.NOT_IMPLEMENTED | HttpStatusCode.SERVICE_UNAVAILABLE
    >
  >;

  /**
   * Determine if a distributed validator has been selected to make a sync committee contribution
   *
   * This endpoint is implemented by a distributed validator middleware client to exchange
   * partial sync committee selection proofs for combined/aggregated selection proofs to allow
   * a validator client to correctly determine if one of its validators has been selected to
   * perform a sync committee contribution (sync aggregation) duty in this slot.
   *
   * Note that this endpoint is not implemented by the beacon node and will return a 501 error
   *
   * @param requestBody An array of partial sync committee selection proofs
   * @returns An array of threshold aggregated sync committee selection proofs
   * @throws ApiError
   */
  submitSyncCommitteeSelections(
    selections: SyncCommitteeSelection[]
  ): Promise<
    ApiClientResponse<
      {[HttpStatusCode.OK]: {data: SyncCommitteeSelection[]}},
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.NOT_IMPLEMENTED | HttpStatusCode.SERVICE_UNAVAILABLE
    >
  >;

  /** Returns validator indices that have been observed to be active on the network */
  getLiveness(
    epoch: Epoch,
    validatorIndices: ValidatorIndex[]
  ): Promise<ApiClientResponse<{[HttpStatusCode.OK]: {data: LivenessResponseData[]}}, HttpStatusCode.BAD_REQUEST>>;

  registerValidator(
    registrations: bellatrix.SignedValidatorRegistrationV1[]
  ): Promise<ApiClientResponse<{[HttpStatusCode.OK]: void}, HttpStatusCode.BAD_REQUEST>>;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getAttesterDuties: {url: "/eth/v1/validator/duties/attester/{epoch}", method: "POST"},
  getProposerDuties: {url: "/eth/v1/validator/duties/proposer/{epoch}", method: "GET"},
  getSyncCommitteeDuties: {url: "/eth/v1/validator/duties/sync/{epoch}", method: "POST"},
  produceBlock: {url: "/eth/v1/validator/blocks/{slot}", method: "GET"},
  produceBlockV2: {url: "/eth/v2/validator/blocks/{slot}", method: "GET"},
  produceBlockV3: {url: "/eth/v3/validator/blocks/{slot}", method: "GET"},
  produceBlindedBlock: {url: "/eth/v1/validator/blinded_blocks/{slot}", method: "GET"},
  produceAttestationData: {url: "/eth/v1/validator/attestation_data", method: "GET"},
  produceSyncCommitteeContribution: {url: "/eth/v1/validator/sync_committee_contribution", method: "GET"},
  getAggregatedAttestation: {url: "/eth/v1/validator/aggregate_attestation", method: "GET"},
  publishAggregateAndProofs: {url: "/eth/v1/validator/aggregate_and_proofs", method: "POST"},
  publishContributionAndProofs: {url: "/eth/v1/validator/contribution_and_proofs", method: "POST"},
  prepareBeaconCommitteeSubnet: {url: "/eth/v1/validator/beacon_committee_subscriptions", method: "POST"},
  prepareSyncCommitteeSubnets: {url: "/eth/v1/validator/sync_committee_subscriptions", method: "POST"},
  prepareBeaconProposer: {url: "/eth/v1/validator/prepare_beacon_proposer", method: "POST"},
  submitBeaconCommitteeSelections: {url: "/eth/v1/validator/beacon_committee_selections", method: "POST"},
  submitSyncCommitteeSelections: {url: "/eth/v1/validator/sync_committee_selections", method: "POST"},
  getLiveness: {url: "/eth/v1/validator/liveness/{epoch}", method: "POST"},
  registerValidator: {url: "/eth/v1/validator/register_validator", method: "POST"},
};

/* eslint-disable @typescript-eslint/naming-convention */
export type ReqTypes = {
  getAttesterDuties: {params: {epoch: Epoch}; body: U64Str[]};
  getProposerDuties: {params: {epoch: Epoch}};
  getSyncCommitteeDuties: {params: {epoch: Epoch}; body: U64Str[]};
  produceBlock: {params: {slot: number}; query: {randao_reveal: string; graffiti: string}};
  produceBlockV2: {params: {slot: number}; query: {randao_reveal: string; graffiti: string; fee_recipient?: string}};
  produceBlockV3: {
    params: {slot: number};
    query: {
      randao_reveal: string;
      graffiti: string;
      skip_randao_verification?: boolean;
      fee_recipient?: string;
      builder_selection?: string;
      builder_boost_factor?: UintNum64;
      strict_fee_recipient_check?: boolean;
      blinded_local?: boolean;
    };
  };
  produceBlindedBlock: {params: {slot: number}; query: {randao_reveal: string; graffiti: string}};
  produceAttestationData: {query: {slot: number; committee_index: number}};
  produceSyncCommitteeContribution: {query: {slot: number; subcommittee_index: number; beacon_block_root: string}};
  getAggregatedAttestation: {query: {attestation_data_root: string; slot: number}};
  publishAggregateAndProofs: {body: unknown};
  publishContributionAndProofs: {body: unknown};
  prepareBeaconCommitteeSubnet: {body: unknown};
  prepareSyncCommitteeSubnets: {body: unknown};
  prepareBeaconProposer: {body: unknown};
  submitBeaconCommitteeSelections: {body: unknown};
  submitSyncCommitteeSelections: {body: unknown};
  getLiveness: {params: {epoch: Epoch}; body: U64Str[]};
  registerValidator: {body: unknown};
};

const BeaconCommitteeSelection = new ContainerType(
  {
    validatorIndex: ssz.ValidatorIndex,
    slot: ssz.Slot,
    selectionProof: ssz.BLSSignature,
  },
  {jsonCase: "eth2"}
);

const SyncCommitteeSelection = new ContainerType(
  {
    validatorIndex: ssz.ValidatorIndex,
    slot: ssz.Slot,
    subcommitteeIndex: ssz.SubcommitteeIndex,
    selectionProof: ssz.BLSSignature,
  },
  {jsonCase: "eth2"}
);

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

  const produceBlockV3: ReqSerializers<Api, ReqTypes>["produceBlockV3"] = {
    writeReq: (slot, randaoReveal, graffiti, skipRandaoVerification, opts) => ({
      params: {slot},
      query: {
        randao_reveal: toHexString(randaoReveal),
        graffiti: toGraffitiHex(graffiti),
        fee_recipient: opts?.feeRecipient,
        skip_randao_verification: skipRandaoVerification,
        builder_selection: opts?.builderSelection,
        builder_boost_factor: opts?.builderBoostFactor,
        strict_fee_recipient_check: opts?.strictFeeRecipientCheck,
        blinded_local: opts?.blindedLocal,
      },
    }),
    parseReq: ({params, query}) => [
      params.slot,
      fromHexString(query.randao_reveal),
      fromGraffitiHex(query.graffiti),
      query.skip_randao_verification,
      {
        feeRecipient: query.fee_recipient,
        builderSelection: query.builder_selection as BuilderSelection,
        builderBoostFactor: query.builder_boost_factor,
        strictFeeRecipientCheck: query.strict_fee_recipient_check,
        blindedLocal: query.blinded_local,
      },
    ],
    schema: {
      params: {slot: Schema.UintRequired},
      query: {
        randao_reveal: Schema.StringRequired,
        graffiti: Schema.String,
        fee_recipient: Schema.String,
        skip_randao_verification: Schema.Boolean,
        builder_selection: Schema.String,
        builder_boost_factor: Schema.Uint,
        strict_fee_recipient_check: Schema.Boolean,
        blinded_local: Schema.Boolean,
      },
    },
  };

  return {
    getAttesterDuties: {
      writeReq: (epoch, indexes) => ({params: {epoch}, body: indexes.map((i) => toU64Str(i))}),
      parseReq: ({params, body}) => [params.epoch, body.map((i) => fromU64Str(i))],
      schema: {
        params: {epoch: Schema.UintRequired},
        body: Schema.StringArray,
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
      writeReq: (epoch, indexes) => ({params: {epoch}, body: indexes.map((i) => toU64Str(i))}),
      parseReq: ({params, body}) => [params.epoch, body.map((i) => fromU64Str(i))],
      schema: {
        params: {epoch: Schema.UintRequired},
        body: Schema.StringArray,
      },
    },

    produceBlock: produceBlockV3 as ReqSerializers<Api, ReqTypes>["produceBlock"],
    produceBlockV2: produceBlockV3 as ReqSerializers<Api, ReqTypes>["produceBlockV2"],
    produceBlockV3,
    produceBlindedBlock: produceBlockV3 as ReqSerializers<Api, ReqTypes>["produceBlindedBlock"],

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
    prepareBeaconProposer: {
      writeReq: (items: ProposerPreparationData[]) => ({body: items.map((item) => jsonType("snake").toJson(item))}),
      parseReq: ({body}) => [
        (body as Record<string, unknown>[]).map((item) => jsonType("snake").fromJson(item) as ProposerPreparationData),
      ],
      schema: {body: Schema.ObjectArray},
    },
    submitBeaconCommitteeSelections: {
      writeReq: (items) => ({body: ArrayOf(BeaconCommitteeSelection).toJson(items)}),
      parseReq: () => [[]],
    },
    submitSyncCommitteeSelections: {
      writeReq: (items) => ({body: ArrayOf(SyncCommitteeSelection).toJson(items)}),
      parseReq: () => [[]],
    },
    getLiveness: {
      writeReq: (epoch, indexes) => ({params: {epoch}, body: indexes.map((i) => toU64Str(i))}),
      parseReq: ({params, body}) => [params.epoch, body.map((i) => fromU64Str(i))],
      schema: {
        params: {epoch: Schema.UintRequired},
        body: Schema.StringArray,
      },
    },
    registerValidator: reqOnlyBody(ArrayOf(ssz.bellatrix.SignedValidatorRegistrationV1), Schema.ObjectArray),
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  const rootHexType = new StringType();

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const WithDependentRootExecutionOptimistic = <T>(dataType: Type<T>) =>
    new ContainerType(
      {
        executionOptimistic: ssz.Boolean,
        data: dataType,
        dependentRoot: rootHexType,
      },
      {jsonCase: "eth2"}
    );

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

  const produceBlockOrContents = WithBlockValues(
    WithVersion<allForks.BeaconBlockOrContents>((fork: ForkName) =>
      isForkBlobs(fork) ? allForksBlockContentsResSerializer(fork) : ssz[fork].BeaconBlock
    )
  ) as TypeJson<ProduceBlockOrContentsRes>;
  const produceBlindedBlock = WithBlockValues(
    WithVersion<allForks.BlindedBeaconBlock>(
      (fork: ForkName) => ssz.allForksBlinded[isForkExecution(fork) ? fork : ForkName.bellatrix].BeaconBlock
    )
  ) as TypeJson<ProduceBlindedBlockRes>;

  return {
    getAttesterDuties: WithDependentRootExecutionOptimistic(ArrayOf(AttesterDuty)),
    getProposerDuties: WithDependentRootExecutionOptimistic(ArrayOf(ProposerDuty)),
    getSyncCommitteeDuties: ContainerDataExecutionOptimistic(ArrayOf(SyncDuty)),

    produceBlock: ContainerData(ssz.phase0.BeaconBlock),
    produceBlockV2: produceBlockOrContents,
    produceBlockV3: {
      toJson: (data) => {
        if (data.executionPayloadBlinded) {
          return {
            execution_payload_blinded: true,
            execution_payload_source: data.executionPayloadSource,
            ...(produceBlindedBlock.toJson(data) as Record<string, unknown>),
          };
        } else {
          return {
            execution_payload_blinded: false,
            execution_payload_source: data.executionPayloadSource,
            ...(produceBlockOrContents.toJson(data) as Record<string, unknown>),
          };
        }
      },
      fromJson: (data) => {
        const executionPayloadBlinded = (data as {execution_payload_blinded: boolean}).execution_payload_blinded;
        if (executionPayloadBlinded === undefined) {
          throw Error(`Invalid executionPayloadBlinded=${executionPayloadBlinded} for fromJson deserialization`);
        }

        // extract source from the data and assign defaults in the spec complaint manner if not present in response
        const executionPayloadSource =
          (data as {execution_payload_source: ProducedBlockSource}).execution_payload_source ??
          (executionPayloadBlinded ? ProducedBlockSource.builder : ProducedBlockSource.engine);

        if (executionPayloadBlinded) {
          return {executionPayloadBlinded, executionPayloadSource, ...produceBlindedBlock.fromJson(data)};
        } else {
          return {executionPayloadBlinded, executionPayloadSource, ...produceBlockOrContents.fromJson(data)};
        }
      },
    },
    produceBlindedBlock,

    produceAttestationData: ContainerData(ssz.phase0.AttestationData),
    produceSyncCommitteeContribution: ContainerData(ssz.altair.SyncCommitteeContribution),
    getAggregatedAttestation: ContainerData(ssz.phase0.Attestation),
    submitBeaconCommitteeSelections: ContainerData(ArrayOf(BeaconCommitteeSelection)),
    submitSyncCommitteeSelections: ContainerData(ArrayOf(SyncCommitteeSelection)),
    getLiveness: jsonType("snake"),
  };
}
