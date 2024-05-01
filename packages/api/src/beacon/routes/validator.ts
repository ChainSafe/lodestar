/* eslint-disable @typescript-eslint/naming-convention */
import {ContainerType, fromHexString, toHexString, Type, ValueOf} from "@chainsafe/ssz";
import {ForkName, isForkBlobs, isForkExecution} from "@lodestar/params";
import {
  allForks,
  altair,
  BLSSignature,
  CommitteeIndex,
  Epoch,
  phase0,
  Root,
  Slot,
  ssz,
  UintBn64,
  ValidatorIndex,
  ProducedBlockSource,
  stringType,
  Wei,
} from "@lodestar/types";
import {Endpoint, RouteDefinitions, Schema} from "../../utils/index.js";
import {fromGraffitiHex, toBoolean, toForkName, toGraffitiHex} from "../../utils/serdes.js";
import {
  ArrayOf,
  EmptyMeta,
  EmptyMetaCodec,
  EmptyResponseCodec,
  EmptyResponseData,
  ExecutionOptimisticAndDependentRootCodec,
  ExecutionOptimisticAndDependentRootMeta,
  ExecutionOptimisticCodec,
  ExecutionOptimisticMeta,
  JsonOnlyReq,
  VersionCodec,
  VersionMeta,
  WithMeta,
  WithVersion,
} from "../../utils/codecs.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export enum BuilderSelection {
  Default = "default",
  BuilderAlways = "builderalways",
  ExecutionAlways = "executionalways",
  MaxProfit = "maxprofit",
  /** Only activate builder flow for DVT block proposal protocols */
  BuilderOnly = "builderonly",
  /** Only builds execution block*/
  ExecutionOnly = "executiononly",
}

/** Lodestar-specific (non-standardized) options */
export type ExtraProduceBlockOpts = {
  feeRecipient?: string;
  builderSelection?: BuilderSelection;
  strictFeeRecipientCheck?: boolean;
  blindedLocal?: boolean;
};

export type ProduceBlockV3Meta = VersionMeta & {
  executionPayloadBlinded: boolean;
  executionPayloadValue: Wei;
  consensusBlockValue: Wei;
  /** Lodestar-specific (non-standardized) value */
  executionPayloadSource: ProducedBlockSource;
};

export const BlockContentsType = new ContainerType(
  {
    block: ssz.deneb.BeaconBlock,
    kzgProofs: ssz.deneb.KZGProofs,
    blobs: ssz.deneb.Blobs,
  },
  {jsonCase: "eth2"}
);

export const AttesterDutyType = new ContainerType(
  {
    // The validator's public key, uniquely identifying them
    pubkey: ssz.BLSPubkey,
    // Index of validator in validator registry
    validatorIndex: ssz.ValidatorIndex,
    committeeIndex: ssz.CommitteeIndex,
    // Number of validators in committee
    committeeLength: ssz.UintNum64,
    // Number of committees at the provided slot
    committeesAtSlot: ssz.UintNum64,
    // Index of validator in committee
    validatorCommitteeIndex: ssz.UintNum64,
    // The slot at which the validator must attest.
    slot: ssz.Slot,
  },
  {jsonCase: "eth2"}
);

export const ProposerDutyType = new ContainerType(
  {
    slot: ssz.Slot,
    validatorIndex: ssz.ValidatorIndex,
    pubkey: ssz.BLSPubkey,
  },
  {jsonCase: "eth2"}
);

/**
 * From https://github.com/ethereum/beacon-APIs/pull/134
 */
export const SyncDutyType = new ContainerType(
  {
    pubkey: ssz.BLSPubkey,
    /** Index of validator in validator registry. */
    validatorIndex: ssz.ValidatorIndex,
    /** The indices of the validator in the sync committee. */
    validatorSyncCommitteeIndices: ArrayOf(ssz.CommitteeIndex),
  },
  {jsonCase: "eth2"}
);

export const BeaconCommitteeSubscriptionType = new ContainerType(
  {
    validatorIndex: ssz.ValidatorIndex,
    committeeIndex: ssz.CommitteeIndex,
    committeesAtSlot: ssz.Slot,
    slot: ssz.Slot,
    isAggregator: ssz.Boolean,
  },
  {jsonCase: "eth2"}
);

/**
 * From https://github.com/ethereum/beacon-APIs/pull/136
 */
export const SyncCommitteeSubscriptionType = new ContainerType(
  {
    validatorIndex: ssz.ValidatorIndex,
    syncCommitteeIndices: ArrayOf(ssz.CommitteeIndex),
    untilEpoch: ssz.Epoch,
  },
  {jsonCase: "eth2"}
);

export const ProposerPreparationDataType = new ContainerType(
  {
    validatorIndex: ssz.ValidatorIndex,
    feeRecipient: stringType,
  },
  {jsonCase: "eth2"}
);

/**
 * From https://github.com/ethereum/beacon-APIs/pull/224
 */
export const BeaconCommitteeSelectionType = new ContainerType(
  {
    /** Index of the validator */
    validatorIndex: ssz.ValidatorIndex,
    /** The slot at which a validator is assigned to attest */
    slot: ssz.Slot,
    /** The `slot_signature` calculated by the validator for the upcoming attestation slot */
    selectionProof: ssz.BLSSignature,
  },
  {jsonCase: "eth2"}
);

/**
 * From https://github.com/ethereum/beacon-APIs/pull/224
 */
export const SyncCommitteeSelectionType = new ContainerType(
  {
    /** Index of the validator */
    validatorIndex: ssz.ValidatorIndex,
    /** The slot at which validator is assigned to produce a sync committee contribution */
    slot: ssz.Slot,
    /** SubcommitteeIndex to which the validator is assigned */
    subcommitteeIndex: ssz.SubcommitteeIndex,
    /** The `slot_signature` calculated by the validator for the upcoming sync committee slot */
    selectionProof: ssz.BLSSignature,
  },
  {jsonCase: "eth2"}
);

export const LivenessResponseDataType = new ContainerType(
  {
    index: ssz.ValidatorIndex,
    isLive: ssz.Boolean,
  },
  {jsonCase: "eth2"}
);

export const ValidatorIndicesType = ArrayOf(ssz.ValidatorIndex);
export const AttesterDutyListType = ArrayOf(AttesterDutyType);
export const ProposerDutyListType = ArrayOf(ProposerDutyType);
export const SyncDutyListType = ArrayOf(SyncDutyType);
export const SignedAggregateAndProofListType = ArrayOf(ssz.phase0.SignedAggregateAndProof);
export const SignedContributionAndProofListType = ArrayOf(ssz.altair.SignedContributionAndProof);
export const BeaconCommitteeSubscriptionListType = ArrayOf(BeaconCommitteeSubscriptionType);
export const SyncCommitteeSubscriptionListType = ArrayOf(SyncCommitteeSubscriptionType);
export const ProposerPreparationDataListType = ArrayOf(ProposerPreparationDataType);
export const BeaconCommitteeSelectionListType = ArrayOf(BeaconCommitteeSelectionType);
export const SyncCommitteeSelectionListType = ArrayOf(SyncCommitteeSelectionType);
export const LivenessResponseDataListType = ArrayOf(LivenessResponseDataType);
export const SignedValidatorRegistrationV1ListType = ArrayOf(ssz.bellatrix.SignedValidatorRegistrationV1);

export type ValidatorIndices = ValueOf<typeof ValidatorIndicesType>;
export type AttesterDuty = ValueOf<typeof AttesterDutyType>;
export type AttesterDutyList = ValueOf<typeof AttesterDutyListType>;
export type ProposerDuty = ValueOf<typeof ProposerDutyType>;
export type ProposerDutyList = ValueOf<typeof ProposerDutyListType>;
export type SyncDuty = ValueOf<typeof SyncDutyType>;
export type SyncDutyList = ValueOf<typeof SyncDutyListType>;
export type SignedAggregateAndProofList = ValueOf<typeof SignedAggregateAndProofListType>;
export type SignedContributionAndProofList = ValueOf<typeof SignedContributionAndProofListType>;
export type BeaconCommitteeSubscription = ValueOf<typeof BeaconCommitteeSubscriptionType>;
export type BeaconCommitteeSubscriptionList = ValueOf<typeof BeaconCommitteeSubscriptionListType>;
export type SyncCommitteeSubscription = ValueOf<typeof SyncCommitteeSubscriptionType>;
export type SyncCommitteeSubscriptionList = ValueOf<typeof SyncCommitteeSubscriptionListType>;
export type ProposerPreparationData = ValueOf<typeof ProposerPreparationDataType>;
export type ProposerPreparationDataList = ValueOf<typeof ProposerPreparationDataListType>;
export type BeaconCommitteeSelection = ValueOf<typeof BeaconCommitteeSelectionType>;
export type BeaconCommitteeSelectionList = ValueOf<typeof BeaconCommitteeSelectionListType>;
export type SyncCommitteeSelection = ValueOf<typeof SyncCommitteeSelectionType>;
export type SyncCommitteeSelectionList = ValueOf<typeof SyncCommitteeSelectionListType>;
export type LivenessResponseData = ValueOf<typeof LivenessResponseDataType>;
export type LivenessResponseDataList = ValueOf<typeof LivenessResponseDataListType>;
export type SignedValidatorRegistrationV1List = ValueOf<typeof SignedValidatorRegistrationV1ListType>;

export type Endpoints = {
  /**
   * Get attester duties
   * Requests the beacon node to provide a set of attestation duties, which should be performed by validators, for a particular epoch.
   * Duties should only need to be checked once per epoch, however a chain reorganization (of > MIN_SEED_LOOKAHEAD epochs) could occur, resulting in a change of duties. For full safety, you should monitor head events and confirm the dependent root in this response matches:
   * - event.previous_duty_dependent_root when `compute_epoch_at_slot(event.slot) == epoch`
   * - event.current_duty_dependent_root when `compute_epoch_at_slot(event.slot) + 1 == epoch`
   * - event.block otherwise
   * The dependent_root value is `get_block_root_at_slot(state, compute_start_slot_at_epoch(epoch - 1) - 1)` or the genesis block root in the case of underflow.
   * param epoch Should only be allowed 1 epoch ahead
   * param requestBody An array of the validator indices for which to obtain the duties.
   */
  getAttesterDuties: Endpoint<
    "POST",
    {
      epoch: Epoch;
      indices: ValidatorIndices;
    },
    {params: {epoch: Epoch}; body: unknown},
    AttesterDutyList,
    ExecutionOptimisticAndDependentRootMeta
  >;

  /**
   * Get block proposers duties
   * Request beacon node to provide all validators that are scheduled to propose a block in the given epoch.
   * Duties should only need to be checked once per epoch, however a chain reorganization could occur that results in a change of duties. For full safety, you should monitor head events and confirm the dependent root in this response matches:
   * - event.current_duty_dependent_root when `compute_epoch_at_slot(event.slot) == epoch`
   * - event.block otherwise
   * The dependent_root value is `get_block_root_at_slot(state, compute_start_slot_at_epoch(epoch) - 1)` or the genesis block root in the case of underflow.
   */
  getProposerDuties: Endpoint<
    "GET",
    {epoch: Epoch},
    {params: {epoch: Epoch}},
    ProposerDutyList,
    ExecutionOptimisticAndDependentRootMeta
  >;

  getSyncCommitteeDuties: Endpoint<
    "POST",
    {
      epoch: number;
      indices: ValidatorIndices;
    },
    {params: {epoch: Epoch}; body: unknown},
    SyncDutyList,
    ExecutionOptimisticMeta
  >;

  /**
   * Produce a new block, without signature.
   * Requests a beacon node to produce a valid block, which can then be signed by a validator.
   * param slot The slot for which the block should be proposed.
   * param randaoReveal The validator's randao reveal value.
   * param graffiti Arbitrary data validator wants to include in block.
   */
  produceBlock: Endpoint<
    "GET",
    {
      slot: Slot;
      randaoReveal: BLSSignature;
      graffiti: string;
    },
    {params: {slot: number}; query: {randao_reveal: string; graffiti: string}},
    allForks.BeaconBlock,
    VersionMeta
  >;

  /**
   * Requests a beacon node to produce a valid block, which can then be signed by a validator.
   * Metadata in the response indicates the type of block produced, and the supported types of block
   * will be added to as forks progress.
   * param slot The slot for which the block should be proposed.
   * param randaoReveal The validator's randao reveal value.
   * param graffiti Arbitrary data validator wants to include in block.
   */
  produceBlockV2: Endpoint<
    "GET",
    {
      slot: Slot;
      randaoReveal: BLSSignature;
      graffiti: string;
    } & Omit<ExtraProduceBlockOpts, "blindedLocal">,
    {
      params: {slot: number};
      query: {
        randao_reveal: string;
        graffiti: string;
        fee_recipient?: string;
        builder_selection?: string;
        strict_fee_recipient_check?: boolean;
      };
    },
    allForks.BeaconBlockOrContents,
    VersionMeta
  >;

  /**
   * Requests a beacon node to produce a valid block, which can then be signed by a validator.
   * Metadata in the response indicates the type of block produced, and the supported types of block
   * will be added to as forks progress.
   * param slot The slot for which the block should be proposed.
   * param randaoReveal The validator's randao reveal value.
   * param graffiti Arbitrary data validator wants to include in block.
   */
  produceBlockV3: Endpoint<
    "GET",
    {
      slot: Slot;
      randaoReveal: BLSSignature;
      graffiti: string;
      skipRandaoVerification?: boolean;
      builderBoostFactor?: UintBn64;
    } & ExtraProduceBlockOpts,
    {
      params: {slot: number};
      query: {
        randao_reveal: string;
        graffiti: string;
        skip_randao_verification?: string;
        fee_recipient?: string;
        builder_selection?: string;
        builder_boost_factor?: string;
        strict_fee_recipient_check?: boolean;
        blinded_local?: boolean;
      };
    },
    allForks.FullOrBlindedBeaconBlockOrContents,
    ProduceBlockV3Meta
  >;

  produceBlindedBlock: Endpoint<
    "GET",
    {
      slot: Slot;
      randaoReveal: BLSSignature;
      graffiti: string;
    },
    {params: {slot: number}; query: {randao_reveal: string; graffiti: string}},
    allForks.BlindedBeaconBlock,
    VersionMeta
  >;

  /**
   * Produce an attestation data
   * Requests that the beacon node produce an AttestationData.
   * param slot The slot for which an attestation data should be created.
   * param committeeIndex The committee index for which an attestation data should be created.
   */
  produceAttestationData: Endpoint<
    "GET",
    {
      committeeIndex: CommitteeIndex;
      slot: Slot;
    },
    {query: {slot: number; committee_index: number}},
    phase0.AttestationData,
    EmptyMeta
  >;

  produceSyncCommitteeContribution: Endpoint<
    "GET",
    {
      slot: Slot;
      subcommitteeIndex: number;
      beaconBlockRoot: Root;
    },
    {query: {slot: number; subcommittee_index: number; beacon_block_root: string}},
    altair.SyncCommitteeContribution,
    EmptyMeta
  >;

  /**
   * Get aggregated attestation
   * Aggregates all attestations matching given attestation data root and slot
   * param attestationDataRoot HashTreeRoot of AttestationData that validator want's aggregated
   * returns aggregated `Attestation` object with same `AttestationData` root.
   */
  getAggregatedAttestation: Endpoint<
    "GET",
    {
      attestationDataRoot: Root;
      slot: Slot;
    },
    {query: {attestation_data_root: string; slot: number}},
    phase0.Attestation,
    EmptyMeta
  >;

  /**
   * Publish multiple aggregate and proofs
   * Verifies given aggregate and proofs and publishes them on appropriate gossipsub topic.
   */
  publishAggregateAndProofs: Endpoint<
    "POST",
    {
      signedAggregateAndProofs: SignedAggregateAndProofList;
    },
    {body: unknown},
    EmptyResponseData,
    EmptyMeta
  >;

  publishContributionAndProofs: Endpoint<
    "POST",
    {
      contributionAndProofs: SignedContributionAndProofList;
    },
    {body: unknown},
    EmptyResponseData,
    EmptyMeta
  >;

  /**
   * Signal beacon node to prepare for a committee subnet
   * After beacon node receives this request,
   * search using discv5 for peers related to this subnet
   * and replace current peers with those ones if necessary
   * If validator `is_aggregator`, beacon node must:
   * - announce subnet topic subscription on gossipsub
   * - aggregate attestations received on that subnet
   *
   * returns any Slot signature is valid and beacon node has prepared the attestation subnet.
   *
   * Note that, we cannot be certain Beacon node will find peers for that subnet for various reasons,"
   */
  prepareBeaconCommitteeSubnet: Endpoint<
    "POST",
    {
      subscriptions: BeaconCommitteeSubscriptionList;
    },
    {body: unknown},
    EmptyResponseData,
    EmptyMeta
  >;

  prepareSyncCommitteeSubnets: Endpoint<
    "POST",
    {
      subscriptions: SyncCommitteeSubscriptionList;
    },
    {body: unknown},
    EmptyResponseData,
    EmptyMeta
  >;

  prepareBeaconProposer: Endpoint<
    "POST",
    {
      proposers: ProposerPreparationDataList;
    },
    {body: unknown},
    EmptyResponseData,
    EmptyMeta
  >;

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
  submitBeaconCommitteeSelections: Endpoint<
    "POST",
    {
      selections: BeaconCommitteeSelectionList;
    },
    {body: unknown},
    BeaconCommitteeSelectionList,
    EmptyMeta
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
  submitSyncCommitteeSelections: Endpoint<
    "POST",
    {
      selections: SyncCommitteeSelectionList;
    },
    {body: unknown},
    SyncCommitteeSelectionList,
    EmptyMeta
  >;

  /** Returns validator indices that have been observed to be active on the network */
  getLiveness: Endpoint<
    "POST",
    {
      epoch: Epoch;
      indices: ValidatorIndex[];
    },
    {params: {epoch: Epoch}; body: unknown},
    LivenessResponseDataList,
    EmptyMeta
  >;

  registerValidator: Endpoint<
    "POST",
    {
      registrations: SignedValidatorRegistrationV1List;
    },
    {body: unknown},
    EmptyResponseData,
    EmptyMeta
  >;
};

/**
 * Define javascript values for each route
 */
export const definitions: RouteDefinitions<Endpoints> = {
  getAttesterDuties: {
    url: "/eth/v1/validator/duties/attester/{epoch}",
    method: "POST",
    req: {
      writeReqJson: ({epoch, indices}) => ({params: {epoch}, body: ValidatorIndicesType.toJson(indices)}),
      parseReqJson: ({params, body}) => ({epoch: params.epoch, indices: ValidatorIndicesType.fromJson(body)}),
      writeReqSsz: ({epoch, indices}) => ({params: {epoch}, body: ValidatorIndicesType.serialize(indices)}),
      parseReqSsz: ({params, body}) => ({epoch: params.epoch, indices: ValidatorIndicesType.deserialize(body)}),
      schema: {
        params: {epoch: Schema.UintRequired},
        body: Schema.StringArray,
      },
    },
    resp: {
      data: AttesterDutyListType,
      meta: ExecutionOptimisticAndDependentRootCodec,
    },
  },
  getProposerDuties: {
    url: "/eth/v1/validator/duties/proposer/{epoch}",
    method: "GET",
    req: {
      writeReq: ({epoch}) => ({params: {epoch}}),
      parseReq: ({params}) => ({epoch: params.epoch}),
      schema: {
        params: {epoch: Schema.UintRequired},
      },
    },
    resp: {
      data: ProposerDutyListType,
      meta: ExecutionOptimisticAndDependentRootCodec,
    },
  },
  getSyncCommitteeDuties: {
    url: "/eth/v1/validator/duties/sync/{epoch}",
    method: "POST",
    req: {
      writeReqJson: ({epoch, indices}) => ({params: {epoch}, body: ValidatorIndicesType.toJson(indices)}),
      parseReqJson: ({params, body}) => ({epoch: params.epoch, indices: ValidatorIndicesType.fromJson(body)}),
      writeReqSsz: ({epoch, indices}) => ({params: {epoch}, body: ValidatorIndicesType.serialize(indices)}),
      parseReqSsz: ({params, body}) => ({epoch: params.epoch, indices: ValidatorIndicesType.deserialize(body)}),
      schema: {
        params: {epoch: Schema.UintRequired},
        body: Schema.StringArray,
      },
    },
    resp: {
      data: SyncDutyListType,
      meta: ExecutionOptimisticCodec,
    },
  },
  produceBlock: {
    url: "/eth/v1/validator/blocks/{slot}",
    method: "GET",
    req: {
      writeReq: ({slot, randaoReveal, graffiti}) => ({
        params: {slot},
        query: {randao_reveal: toHexString(randaoReveal), graffiti: toGraffitiHex(graffiti)},
      }),
      parseReq: ({params, query}) => ({
        slot: params.slot,
        randaoReveal: fromHexString(query.randao_reveal),
        graffiti: fromGraffitiHex(query.graffiti),
      }),
      schema: {
        params: {slot: Schema.UintRequired},
        query: {
          randao_reveal: Schema.StringRequired,
          graffiti: Schema.String,
        },
      },
    },
    resp: {
      data: WithVersion((fork) => ssz[fork].BeaconBlock),
      meta: VersionCodec,
    },
  },
  produceBlockV2: {
    url: "/eth/v2/validator/blocks/{slot}",
    method: "GET",
    req: {
      writeReq: ({slot, randaoReveal, graffiti, feeRecipient, builderSelection, strictFeeRecipientCheck}) => ({
        params: {slot},
        query: {
          randao_reveal: toHexString(randaoReveal),
          graffiti: toGraffitiHex(graffiti),
          fee_recipient: feeRecipient,
          builder_selection: builderSelection,
          strict_fee_recipient_check: strictFeeRecipientCheck,
        },
      }),
      parseReq: ({params, query}) => ({
        slot: params.slot,
        randaoReveal: fromHexString(query.randao_reveal),
        graffiti: fromGraffitiHex(query.graffiti),
        feeRecipient: query.fee_recipient,
        builderSelection: query.builder_selection as BuilderSelection,
        strictFeeRecipientCheck: query.strict_fee_recipient_check,
      }),
      schema: {
        params: {slot: Schema.UintRequired},
        query: {
          randao_reveal: Schema.StringRequired,
          graffiti: Schema.String,
          fee_recipient: Schema.String,
          builder_selection: Schema.String,
          strict_fee_recipient_check: Schema.Boolean,
        },
      },
    },
    resp: {
      data: WithVersion(
        (fork) =>
          (isForkBlobs(fork) ? BlockContentsType : ssz[fork].BeaconBlock) as Type<allForks.BeaconBlockOrContents>
      ),
      meta: VersionCodec,
    },
  },
  produceBlockV3: {
    url: "/eth/v3/validator/blocks/{slot}",
    method: "GET",
    req: {
      writeReq: ({
        slot,
        randaoReveal,
        graffiti,
        skipRandaoVerification,
        feeRecipient,
        builderSelection,
        builderBoostFactor,
        strictFeeRecipientCheck,
        blindedLocal,
      }) => ({
        params: {slot},
        query: {
          randao_reveal: toHexString(randaoReveal),
          graffiti: toGraffitiHex(graffiti),
          skip_randao_verification: writeSkipRandaoVerification(skipRandaoVerification),
          fee_recipient: feeRecipient,
          builder_selection: builderSelection,
          builder_boost_factor: builderBoostFactor?.toString(),
          strict_fee_recipient_check: strictFeeRecipientCheck,
          blinded_local: blindedLocal,
        },
      }),
      parseReq: ({params, query}) => ({
        slot: params.slot,
        randaoReveal: fromHexString(query.randao_reveal),
        graffiti: fromGraffitiHex(query.graffiti),
        skipRandaoVerification: parseSkipRandaoVerification(query.skip_randao_verification),
        feeRecipient: query.fee_recipient,
        builderSelection: query.builder_selection as BuilderSelection,
        builderBoostFactor: parseBuilderBoostFactor(query.builder_boost_factor),
        strictFeeRecipientCheck: query.strict_fee_recipient_check,
        blindedLocal: query.blinded_local,
      }),
      schema: {
        params: {slot: Schema.UintRequired},
        query: {
          randao_reveal: Schema.StringRequired,
          graffiti: Schema.String,
          skip_randao_verification: Schema.String,
          fee_recipient: Schema.String,
          builder_selection: Schema.String,
          builder_boost_factor: Schema.String,
          strict_fee_recipient_check: Schema.Boolean,
          blinded_local: Schema.Boolean,
        },
      },
    },
    resp: {
      data: WithMeta(
        ({version, executionPayloadBlinded}) =>
          (executionPayloadBlinded
            ? ssz.allForksBlinded[isForkExecution(version) ? version : ForkName.bellatrix].BeaconBlock
            : isForkBlobs(version)
              ? BlockContentsType
              : ssz[version].BeaconBlock) as Type<allForks.FullOrBlindedBeaconBlockOrContents>
      ),
      meta: {
        toJson: (meta) => ({
          version: meta.version,
          execution_payload_blinded: meta.executionPayloadBlinded,
          execution_payload_source: meta.executionPayloadSource,
          execution_payload_value: meta.executionPayloadValue.toString(),
          consensus_block_value: meta.consensusBlockValue.toString(),
        }),
        fromJson: (val) => {
          const executionPayloadBlinded = (val as {execution_payload_blinded: boolean}).execution_payload_blinded;

          // Extract source from the data and assign defaults in the spec compliant manner if not present in response
          const executionPayloadSource =
            (val as {execution_payload_source: ProducedBlockSource}).execution_payload_source ??
            (executionPayloadBlinded === true ? ProducedBlockSource.builder : ProducedBlockSource.engine);

          return {
            version: toForkName((val as {version: string}).version),
            executionPayloadBlinded,
            executionPayloadSource,
            executionPayloadValue: BigInt((val as {execution_payload_value: string}).execution_payload_value),
            consensusBlockValue: BigInt((val as {consensus_block_value: string}).consensus_block_value),
          };
        },
        toHeadersObject: (meta) => ({
          "Eth-Consensus-Version": meta.version,
          "Eth-Execution-Payload-Blinded": meta.executionPayloadBlinded.toString(),
          "Eth-Execution-Payload-Source": meta.executionPayloadSource.toString(),
          "Eth-Execution-Payload-Value": meta.executionPayloadValue.toString(),
          "Eth-Consensus-Block-Value": meta.consensusBlockValue.toString(),
        }),
        fromHeaders: (headers) => {
          const executionPayloadBlinded = toBoolean(headers.get("Eth-Execution-Payload-Blinded")!);

          // Extract source from the headers and assign defaults in a spec compliant manner if not present in response
          const executionPayloadSource =
            (headers.get("Eth-Execution-Payload-Source") as ProducedBlockSource) ??
            (executionPayloadBlinded === true ? ProducedBlockSource.builder : ProducedBlockSource.engine);

          return {
            version: toForkName(headers.get("Eth-Consensus-Version")!),
            executionPayloadBlinded,
            executionPayloadSource,
            executionPayloadValue: BigInt(headers.get("Eth-Execution-Payload-Value")!),
            consensusBlockValue: BigInt(headers.get("Eth-Consensus-Block-Value")!),
          };
        },
      },
    },
  },
  produceBlindedBlock: {
    url: "/eth/v1/validator/blinded_blocks/{slot}",
    method: "GET",
    req: {
      writeReq: ({slot, randaoReveal, graffiti}) => ({
        params: {slot},
        query: {randao_reveal: toHexString(randaoReveal), graffiti: toGraffitiHex(graffiti)},
      }),
      parseReq: ({params, query}) => ({
        slot: params.slot,
        randaoReveal: fromHexString(query.randao_reveal),
        graffiti: fromGraffitiHex(query.graffiti),
      }),
      schema: {
        params: {slot: Schema.UintRequired},
        query: {
          randao_reveal: Schema.StringRequired,
          graffiti: Schema.String,
        },
      },
    },
    resp: {
      data: WithVersion((fork) => ssz.allForksBlinded[isForkExecution(fork) ? fork : ForkName.bellatrix].BeaconBlock),
      meta: VersionCodec,
    },
  },
  produceAttestationData: {
    url: "/eth/v1/validator/attestation_data",
    method: "GET",
    req: {
      writeReq: ({committeeIndex, slot}) => ({query: {slot, committee_index: committeeIndex}}),
      parseReq: ({query}) => ({committeeIndex: query.committee_index, slot: query.slot}),
      schema: {
        query: {slot: Schema.UintRequired, committee_index: Schema.UintRequired},
      },
    },
    resp: {
      data: ssz.phase0.AttestationData,
      meta: EmptyMetaCodec,
    },
  },
  produceSyncCommitteeContribution: {
    url: "/eth/v1/validator/sync_committee_contribution",
    method: "GET",
    req: {
      writeReq: ({slot, subcommitteeIndex, beaconBlockRoot}) => ({
        query: {slot, subcommittee_index: subcommitteeIndex, beacon_block_root: toHexString(beaconBlockRoot)},
      }),
      parseReq: ({query}) => ({
        slot: query.slot,
        subcommitteeIndex: query.subcommittee_index,
        beaconBlockRoot: fromHexString(query.beacon_block_root),
      }),
      schema: {
        query: {
          slot: Schema.UintRequired,
          subcommittee_index: Schema.UintRequired,
          beacon_block_root: Schema.StringRequired,
        },
      },
    },
    resp: {
      data: ssz.altair.SyncCommitteeContribution,
      meta: EmptyMetaCodec,
    },
  },
  getAggregatedAttestation: {
    url: "/eth/v1/validator/aggregate_attestation",
    method: "GET",
    req: {
      writeReq: ({attestationDataRoot, slot}) => ({
        query: {attestation_data_root: toHexString(attestationDataRoot), slot},
      }),
      parseReq: ({query}) => ({attestationDataRoot: fromHexString(query.attestation_data_root), slot: query.slot}),
      schema: {
        query: {attestation_data_root: Schema.StringRequired, slot: Schema.UintRequired},
      },
    },
    resp: {
      data: ssz.phase0.Attestation,
      meta: EmptyMetaCodec,
    },
  },
  publishAggregateAndProofs: {
    url: "/eth/v1/validator/aggregate_and_proofs",
    method: "POST",
    req: {
      writeReqJson: ({signedAggregateAndProofs}) => ({
        body: SignedAggregateAndProofListType.toJson(signedAggregateAndProofs),
      }),
      parseReqJson: ({body}) => ({signedAggregateAndProofs: SignedAggregateAndProofListType.fromJson(body)}),
      writeReqSsz: ({signedAggregateAndProofs}) => ({
        body: SignedAggregateAndProofListType.serialize(signedAggregateAndProofs),
      }),
      parseReqSsz: ({body}) => ({signedAggregateAndProofs: SignedAggregateAndProofListType.deserialize(body)}),
      schema: {
        body: Schema.ObjectArray,
      },
    },
    resp: EmptyResponseCodec,
  },
  publishContributionAndProofs: {
    url: "/eth/v1/validator/contribution_and_proofs",
    method: "POST",
    req: {
      writeReqJson: ({contributionAndProofs}) => ({
        body: SignedContributionAndProofListType.toJson(contributionAndProofs),
      }),
      parseReqJson: ({body}) => ({contributionAndProofs: SignedContributionAndProofListType.fromJson(body)}),
      writeReqSsz: ({contributionAndProofs}) => ({
        body: SignedContributionAndProofListType.serialize(contributionAndProofs),
      }),
      parseReqSsz: ({body}) => ({contributionAndProofs: SignedContributionAndProofListType.deserialize(body)}),
      schema: {
        body: Schema.ObjectArray,
      },
    },
    resp: EmptyResponseCodec,
  },
  prepareBeaconCommitteeSubnet: {
    url: "/eth/v1/validator/beacon_committee_subscriptions",
    method: "POST",
    req: {
      writeReqJson: ({subscriptions}) => ({body: BeaconCommitteeSubscriptionListType.toJson(subscriptions)}),
      parseReqJson: ({body}) => ({subscriptions: BeaconCommitteeSubscriptionListType.fromJson(body)}),
      writeReqSsz: ({subscriptions}) => ({body: BeaconCommitteeSubscriptionListType.serialize(subscriptions)}),
      parseReqSsz: ({body}) => ({subscriptions: BeaconCommitteeSubscriptionListType.deserialize(body)}),
      schema: {body: Schema.ObjectArray},
    },
    resp: EmptyResponseCodec,
  },
  prepareSyncCommitteeSubnets: {
    url: "/eth/v1/validator/sync_committee_subscriptions",
    method: "POST",
    req: {
      writeReqJson: ({subscriptions}) => ({body: SyncCommitteeSubscriptionListType.toJson(subscriptions)}),
      parseReqJson: ({body}) => ({subscriptions: SyncCommitteeSubscriptionListType.fromJson(body)}),
      writeReqSsz: ({subscriptions}) => ({body: SyncCommitteeSubscriptionListType.serialize(subscriptions)}),
      parseReqSsz: ({body}) => ({subscriptions: SyncCommitteeSubscriptionListType.deserialize(body)}),
      schema: {body: Schema.ObjectArray},
    },
    resp: EmptyResponseCodec,
  },
  prepareBeaconProposer: {
    url: "/eth/v1/validator/prepare_beacon_proposer",
    method: "POST",
    req: JsonOnlyReq({
      writeReqJson: ({proposers}) => ({body: ProposerPreparationDataListType.toJson(proposers)}),
      parseReqJson: ({body}) => ({proposers: ProposerPreparationDataListType.fromJson(body)}),
      schema: {body: Schema.ObjectArray},
    }),
    resp: EmptyResponseCodec,
  },
  submitBeaconCommitteeSelections: {
    url: "/eth/v1/validator/beacon_committee_selections",
    method: "POST",
    req: {
      writeReqJson: ({selections}) => ({body: BeaconCommitteeSelectionListType.toJson(selections)}),
      parseReqJson: ({body}) => ({selections: BeaconCommitteeSelectionListType.fromJson(body)}),
      writeReqSsz: ({selections}) => ({body: BeaconCommitteeSelectionListType.serialize(selections)}),
      parseReqSsz: ({body}) => ({selections: BeaconCommitteeSelectionListType.deserialize(body)}),
      schema: {
        body: Schema.ObjectArray,
      },
    },
    resp: {
      data: BeaconCommitteeSelectionListType,
      meta: EmptyMetaCodec,
    },
  },
  submitSyncCommitteeSelections: {
    url: "/eth/v1/validator/sync_committee_selections",
    method: "POST",
    req: {
      writeReqJson: ({selections}) => ({body: SyncCommitteeSelectionListType.toJson(selections)}),
      parseReqJson: ({body}) => ({selections: SyncCommitteeSelectionListType.fromJson(body)}),
      writeReqSsz: ({selections}) => ({body: SyncCommitteeSelectionListType.serialize(selections)}),
      parseReqSsz: ({body}) => ({selections: SyncCommitteeSelectionListType.deserialize(body)}),
      schema: {
        body: Schema.ObjectArray,
      },
    },
    resp: {
      data: SyncCommitteeSelectionListType,
      meta: EmptyMetaCodec,
    },
  },
  getLiveness: {
    url: "/eth/v1/validator/liveness/{epoch}",
    method: "POST",
    req: {
      writeReqJson: ({epoch, indices}) => ({params: {epoch}, body: ValidatorIndicesType.toJson(indices)}),
      parseReqJson: ({params, body}) => ({epoch: params.epoch, indices: ValidatorIndicesType.fromJson(body)}),
      writeReqSsz: ({epoch, indices}) => ({params: {epoch}, body: ValidatorIndicesType.serialize(indices)}),
      parseReqSsz: ({params, body}) => ({epoch: params.epoch, indices: ValidatorIndicesType.deserialize(body)}),
      schema: {
        params: {epoch: Schema.UintRequired},
        body: Schema.StringArray,
      },
    },
    resp: {
      data: LivenessResponseDataListType,
      meta: EmptyMetaCodec,
    },
  },
  registerValidator: {
    url: "/eth/v1/validator/register_validator",
    method: "POST",
    req: {
      writeReqJson: ({registrations}) => ({body: SignedValidatorRegistrationV1ListType.toJson(registrations)}),
      parseReqJson: ({body}) => ({registrations: SignedValidatorRegistrationV1ListType.fromJson(body)}),
      writeReqSsz: ({registrations}) => ({body: SignedValidatorRegistrationV1ListType.serialize(registrations)}),
      parseReqSsz: ({body}) => ({registrations: SignedValidatorRegistrationV1ListType.deserialize(body)}),
      schema: {
        body: Schema.ObjectArray,
      },
    },
    resp: EmptyResponseCodec,
  },
};

function parseBuilderBoostFactor(builderBoostFactorInput?: string | number | bigint): bigint | undefined {
  return builderBoostFactorInput !== undefined ? BigInt(builderBoostFactorInput) : undefined;
}

function writeSkipRandaoVerification(skipRandaoVerification?: boolean): string | undefined {
  return skipRandaoVerification === true ? "" : undefined;
}

function parseSkipRandaoVerification(skipRandaoVerification?: string): boolean {
  return skipRandaoVerification !== undefined && skipRandaoVerification === "";
}
