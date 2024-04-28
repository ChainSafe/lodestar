/* eslint-disable @typescript-eslint/naming-convention */
import {ValueOf} from "@chainsafe/ssz";
import {phase0, capella, CommitteeIndex, Slot, ssz} from "@lodestar/types";
import {Schema, Endpoint, RouteDefinitions} from "../../../utils/index.js";
import {
  ArrayOf,
  EmptyArgs,
  EmptyGetRequestCodec,
  EmptyMeta,
  EmptyMetaCodec,
  EmptyRequest,
  EmptyResponseCodec,
  EmptyResponseData,
} from "../../../utils/codecs.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

const AttestationListType = ArrayOf(ssz.phase0.Attestation);
const AttesterSlashingListType = ArrayOf(ssz.phase0.AttesterSlashing);
const ProposerSlashingListType = ArrayOf(ssz.phase0.ProposerSlashing);
const SignedVoluntaryExitListType = ArrayOf(ssz.phase0.SignedVoluntaryExit);
const SignedBLSToExecutionChangeListType = ArrayOf(ssz.capella.SignedBLSToExecutionChange);
const SyncCommitteeMessageListType = ArrayOf(ssz.altair.SyncCommitteeMessage);

type AttestationList = ValueOf<typeof AttestationListType>;
type AttesterSlashingList = ValueOf<typeof AttesterSlashingListType>;
type ProposerSlashingList = ValueOf<typeof ProposerSlashingListType>;
type SignedVoluntaryExitList = ValueOf<typeof SignedVoluntaryExitListType>;
type SignedBLSToExecutionChangeList = ValueOf<typeof SignedBLSToExecutionChangeListType>;
type SyncCommitteeMessageList = ValueOf<typeof SyncCommitteeMessageListType>;

export type Endpoints = {
  /**
   * Get Attestations from operations pool
   * Retrieves attestations known by the node but not necessarily incorporated into any block
   */
  getPoolAttestations: Endpoint<
    "GET",
    {slot?: Slot; committeeIndex?: CommitteeIndex},
    {query: {slot?: number; committee_index?: number}},
    AttestationList,
    EmptyMeta
  >;

  /**
   * Get AttesterSlashings from operations pool
   * Retrieves attester slashings known by the node but not necessarily incorporated into any block
   */
  getPoolAttesterSlashings: Endpoint<
    //
    "GET",
    EmptyArgs,
    EmptyRequest,
    AttesterSlashingList,
    EmptyMeta
  >;

  /**
   * Get ProposerSlashings from operations pool
   * Retrieves proposer slashings known by the node but not necessarily incorporated into any block
   */
  getPoolProposerSlashings: Endpoint<
    //
    "GET",
    EmptyArgs,
    EmptyRequest,
    ProposerSlashingList,
    EmptyMeta
  >;

  /**
   * Get SignedVoluntaryExit from operations pool
   * Retrieves voluntary exits known by the node but not necessarily incorporated into any block
   */
  getPoolVoluntaryExits: Endpoint<
    //
    "GET",
    EmptyArgs,
    EmptyRequest,
    SignedVoluntaryExitList,
    EmptyMeta
  >;

  /**
   * Get SignedBLSToExecutionChange from operations pool
   * Retrieves BLSToExecutionChange known by the node but not necessarily incorporated into any block
   */
  getPoolBLSToExecutionChanges: Endpoint<
    //
    "GET",
    EmptyArgs,
    EmptyRequest,
    SignedBLSToExecutionChangeList,
    EmptyMeta
  >;

  /**
   * Submit Attestation objects to node
   * Submits Attestation objects to the node.  Each attestation in the request body is processed individually.
   *
   * If an attestation is validated successfully the node MUST publish that attestation on the appropriate subnet.
   *
   * If one or more attestations fail validation the node MUST return a 400 error with details of which attestations have failed, and why.
   */
  submitPoolAttestations: Endpoint<
    "POST",
    {attestations: AttestationList},
    {body: unknown},
    EmptyResponseData,
    EmptyMeta
  >;

  /**
   * Submit AttesterSlashing object to node's pool
   * Submits AttesterSlashing object to node's pool and if passes validation node MUST broadcast it to network.
   */
  submitPoolAttesterSlashings: Endpoint<
    "POST",
    {slashing: phase0.AttesterSlashing},
    {body: unknown},
    EmptyResponseData,
    EmptyMeta
  >;

  /**
   * Submit ProposerSlashing object to node's pool
   * Submits ProposerSlashing object to node's pool and if passes validation  node MUST broadcast it to network.
   */
  submitPoolProposerSlashings: Endpoint<
    "POST",
    {slashing: phase0.ProposerSlashing},
    {body: unknown},
    EmptyResponseData,
    EmptyMeta
  >;

  /**
   * Submit SignedVoluntaryExit object to node's pool
   * Submits SignedVoluntaryExit object to node's pool and if passes validation node MUST broadcast it to network.
   */
  submitPoolVoluntaryExit: Endpoint<
    "POST",
    {exit: phase0.SignedVoluntaryExit},
    {body: unknown},
    EmptyResponseData,
    EmptyMeta
  >;

  /**
   * Submit SignedBLSToExecutionChange objects to node's pool
   * Submits SignedBLSToExecutionChange objects to node's pool and if passes validation node MUST broadcast it to network.
   */
  submitPoolBLSToExecutionChange: Endpoint<
    "POST",
    {changes: capella.SignedBLSToExecutionChange[]},
    {body: unknown},
    EmptyResponseData,
    EmptyMeta
  >;

  /**
   * Submit SyncCommitteeMessage objects to node's pool
   * Submits SyncCommitteeMessage objects to node's pool and if passes validation node MUST broadcast it to network.
   */
  submitPoolSyncCommitteeSignatures: Endpoint<
    "POST",
    {signatures: SyncCommitteeMessageList},
    {body: unknown},
    EmptyResponseData,
    EmptyMeta
  >;
};

export const definitions: RouteDefinitions<Endpoints> = {
  getPoolAttestations: {
    url: "/eth/v1/beacon/pool/attestations",
    method: "GET",
    req: {
      writeReq: ({slot, committeeIndex}) => ({query: {slot, committee_index: committeeIndex}}),
      parseReq: ({query}) => ({slot: query.slot, committeeIndex: query.committee_index}),
      schema: {query: {slot: Schema.Uint, committee_index: Schema.Uint}},
    },
    resp: {
      data: AttestationListType,
      meta: EmptyMetaCodec,
    },
  },
  getPoolAttesterSlashings: {
    url: "/eth/v1/beacon/pool/attester_slashings",
    method: "GET",
    req: EmptyGetRequestCodec,
    resp: {
      data: AttesterSlashingListType,
      meta: EmptyMetaCodec,
    },
  },
  getPoolProposerSlashings: {
    url: "/eth/v1/beacon/pool/proposer_slashings",
    method: "GET",
    req: EmptyGetRequestCodec,
    resp: {
      data: ProposerSlashingListType,
      meta: EmptyMetaCodec,
    },
  },
  getPoolVoluntaryExits: {
    url: "/eth/v1/beacon/pool/voluntary_exits",
    method: "GET",
    req: EmptyGetRequestCodec,
    resp: {
      data: SignedVoluntaryExitListType,
      meta: EmptyMetaCodec,
    },
  },
  getPoolBLSToExecutionChanges: {
    url: "/eth/v1/beacon/pool/bls_to_execution_changes",
    method: "GET",
    req: EmptyGetRequestCodec,
    resp: {
      data: SignedBLSToExecutionChangeListType,
      meta: EmptyMetaCodec,
    },
  },
  submitPoolAttestations: {
    url: "/eth/v1/beacon/pool/attestations",
    method: "POST",
    req: {
      writeReqJson: ({attestations}) => ({body: AttestationListType.toJson(attestations)}),
      parseReqJson: ({body}) => ({attestations: AttestationListType.fromJson(body)}),
      writeReqSsz: ({attestations}) => ({body: AttestationListType.serialize(attestations)}),
      parseReqSsz: ({body}) => ({attestations: AttestationListType.deserialize(body)}),
      schema: {
        body: Schema.ObjectArray,
      },
    },
    resp: EmptyResponseCodec,
  },
  submitPoolAttesterSlashings: {
    url: "/eth/v1/beacon/pool/attester_slashings",
    method: "POST",
    req: {
      writeReqJson: ({slashing}) => ({body: ssz.phase0.AttesterSlashing.toJson(slashing)}),
      parseReqJson: ({body}) => ({slashing: ssz.phase0.AttesterSlashing.fromJson(body)}),
      writeReqSsz: ({slashing}) => ({body: ssz.phase0.AttesterSlashing.serialize(slashing)}),
      parseReqSsz: ({body}) => ({slashing: ssz.phase0.AttesterSlashing.deserialize(body)}),
      schema: {
        body: Schema.Object,
      },
    },
    resp: EmptyResponseCodec,
  },
  submitPoolProposerSlashings: {
    url: "/eth/v1/beacon/pool/proposer_slashings",
    method: "POST",
    req: {
      writeReqJson: ({slashing}) => ({body: ssz.phase0.ProposerSlashing.toJson(slashing)}),
      parseReqJson: ({body}) => ({slashing: ssz.phase0.ProposerSlashing.fromJson(body)}),
      writeReqSsz: ({slashing}) => ({body: ssz.phase0.ProposerSlashing.serialize(slashing)}),
      parseReqSsz: ({body}) => ({slashing: ssz.phase0.ProposerSlashing.deserialize(body)}),
      schema: {
        body: Schema.Object,
      },
    },
    resp: EmptyResponseCodec,
  },
  submitPoolVoluntaryExit: {
    url: "/eth/v1/beacon/pool/voluntary_exits",
    method: "POST",
    req: {
      writeReqJson: ({exit}) => ({body: ssz.phase0.SignedVoluntaryExit.toJson(exit)}),
      parseReqJson: ({body}) => ({exit: ssz.phase0.SignedVoluntaryExit.fromJson(body)}),
      writeReqSsz: ({exit}) => ({body: ssz.phase0.SignedVoluntaryExit.serialize(exit)}),
      parseReqSsz: ({body}) => ({exit: ssz.phase0.SignedVoluntaryExit.deserialize(body)}),
      schema: {
        body: Schema.Object,
      },
    },
    resp: EmptyResponseCodec,
  },
  submitPoolBLSToExecutionChange: {
    url: "/eth/v1/beacon/pool/bls_to_execution_changes",
    method: "POST",
    req: {
      writeReqJson: ({changes}) => ({
        body: SignedBLSToExecutionChangeListType.toJson(changes),
      }),
      parseReqJson: ({body}) => ({changes: SignedBLSToExecutionChangeListType.fromJson(body)}),
      writeReqSsz: ({changes}) => ({
        body: SignedBLSToExecutionChangeListType.serialize(changes),
      }),
      parseReqSsz: ({body}) => ({changes: SignedBLSToExecutionChangeListType.deserialize(body)}),
      schema: {
        body: Schema.ObjectArray,
      },
    },
    resp: EmptyResponseCodec,
  },
  submitPoolSyncCommitteeSignatures: {
    url: "/eth/v1/beacon/pool/sync_committees",
    method: "POST",
    req: {
      writeReqJson: ({signatures}) => ({body: SyncCommitteeMessageListType.toJson(signatures)}),
      parseReqJson: ({body}) => ({signatures: SyncCommitteeMessageListType.fromJson(body)}),
      writeReqSsz: ({signatures}) => ({body: SyncCommitteeMessageListType.serialize(signatures)}),
      parseReqSsz: ({body}) => ({signatures: SyncCommitteeMessageListType.deserialize(body)}),
      schema: {
        body: Schema.ObjectArray,
      },
    },
    resp: EmptyResponseCodec,
  },
};
