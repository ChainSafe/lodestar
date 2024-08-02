/* eslint-disable @typescript-eslint/naming-convention */
import {ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {phase0, capella, CommitteeIndex, Slot, ssz} from "@lodestar/types";
import {Schema, Endpoint, RouteDefinitions} from "../../../utils/index.js";
import {
  ArrayOf,
  EmptyArgs,
  EmptyRequestCodec,
  EmptyMeta,
  EmptyMetaCodec,
  EmptyRequest,
  EmptyResponseCodec,
  EmptyResponseData,
  WithVersion,
} from "../../../utils/codecs.js";
import {MetaHeader, VersionCodec, VersionMeta} from "../../../utils/metadata.js";
import {toForkName} from "../../../utils/fork.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

const AttestationListTypePhase0 = ArrayOf(ssz.phase0.Attestation);
const AttestationListTypeElectra = ArrayOf(ssz.electra.Attestation);
const AttesterSlashingListType = ArrayOf(ssz.phase0.AttesterSlashing);
const ProposerSlashingListType = ArrayOf(ssz.phase0.ProposerSlashing);
const SignedVoluntaryExitListType = ArrayOf(ssz.phase0.SignedVoluntaryExit);
const SignedBLSToExecutionChangeListType = ArrayOf(ssz.capella.SignedBLSToExecutionChange);
const SyncCommitteeMessageListType = ArrayOf(ssz.altair.SyncCommitteeMessage);

type AttestationListPhase0 = ValueOf<typeof AttestationListTypePhase0>;
type AttestationListElectra = ValueOf<typeof AttestationListTypeElectra>;
type AttestationList = AttestationListPhase0 | AttestationListElectra;
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
    VersionMeta
  >;

  /**
   * Get AttesterSlashings from operations pool
   * Retrieves attester slashings known by the node but not necessarily incorporated into any block
   */
  getPoolAttesterSlashings: Endpoint<
    // ⏎
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
    // ⏎
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
    // ⏎
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
    // ⏎
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
    {signedAttestations: AttestationList},
    {body: unknown; headers: {[MetaHeader.Version]: string}},
    EmptyResponseData,
    EmptyMeta
  >;

  /**
   * Submit AttesterSlashing object to node's pool
   * Submits AttesterSlashing object to node's pool and if passes validation node MUST broadcast it to network.
   */
  submitPoolAttesterSlashings: Endpoint<
    "POST",
    {attesterSlashing: phase0.AttesterSlashing},
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
    {proposerSlashing: phase0.ProposerSlashing},
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
    {signedVoluntaryExit: phase0.SignedVoluntaryExit},
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
    {blsToExecutionChanges: capella.SignedBLSToExecutionChange[]},
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

export function getDefinitions(config: ChainForkConfig): RouteDefinitions<Endpoints> {
  return {
    getPoolAttestations: {
      url: "/eth/v1/beacon/pool/attestations",
      method: "GET",
      req: {
        writeReq: ({slot, committeeIndex}) => ({query: {slot, committee_index: committeeIndex}}),
        parseReq: ({query}) => ({slot: query.slot, committeeIndex: query.committee_index}),
        schema: {query: {slot: Schema.Uint, committee_index: Schema.Uint}},
      },
      resp: {
        data: WithVersion((fork) =>
          ForkSeq[fork] >= ForkSeq.electra ? AttestationListTypeElectra : AttestationListTypePhase0
        ),
        meta: VersionCodec,
      },
    },
    getPoolAttesterSlashings: {
      url: "/eth/v1/beacon/pool/attester_slashings",
      method: "GET",
      req: EmptyRequestCodec,
      resp: {
        data: AttesterSlashingListType,
        meta: EmptyMetaCodec,
      },
    },
    getPoolProposerSlashings: {
      url: "/eth/v1/beacon/pool/proposer_slashings",
      method: "GET",
      req: EmptyRequestCodec,
      resp: {
        data: ProposerSlashingListType,
        meta: EmptyMetaCodec,
      },
    },
    getPoolVoluntaryExits: {
      url: "/eth/v1/beacon/pool/voluntary_exits",
      method: "GET",
      req: EmptyRequestCodec,
      resp: {
        data: SignedVoluntaryExitListType,
        meta: EmptyMetaCodec,
      },
    },
    getPoolBLSToExecutionChanges: {
      url: "/eth/v1/beacon/pool/bls_to_execution_changes",
      method: "GET",
      req: EmptyRequestCodec,
      resp: {
        data: SignedBLSToExecutionChangeListType,
        meta: EmptyMetaCodec,
      },
    },
    submitPoolAttestations: {
      url: "/eth/v1/beacon/pool/attestations",
      method: "POST",
      req: {
        writeReqJson: ({signedAttestations}) => {
          const fork = config.getForkName(signedAttestations[0].data.slot);
          return {
            body:
              ForkSeq[fork] >= ForkSeq.electra
                ? AttestationListTypeElectra.toJson(signedAttestations as AttestationListElectra)
                : AttestationListTypePhase0.toJson(signedAttestations as AttestationListPhase0),
            headers: {[MetaHeader.Version]: fork},
          };
        },
        parseReqJson: ({body, headers}) => {
          const fork = toForkName(headers[MetaHeader.Version]);
          return {
            signedAttestations:
              ForkSeq[fork] >= ForkSeq.electra
                ? AttestationListTypeElectra.fromJson(body)
                : AttestationListTypePhase0.fromJson(body),
          };
        },
        writeReqSsz: ({signedAttestations}) => {
          const fork = config.getForkName(signedAttestations[0].data.slot);
          return {
            body:
              ForkSeq[fork] >= ForkSeq.electra
                ? AttestationListTypeElectra.serialize(signedAttestations as AttestationListElectra)
                : AttestationListTypePhase0.serialize(signedAttestations as AttestationListPhase0),
            headers: {[MetaHeader.Version]: fork},
          };
        },
        parseReqSsz: ({body, headers}) => {
          const fork = toForkName(headers[MetaHeader.Version]);
          return {
            signedAttestations:
              ForkSeq[fork] >= ForkSeq.electra
                ? AttestationListTypeElectra.deserialize(body)
                : AttestationListTypePhase0.deserialize(body),
          };
        },
        schema: {
          body: Schema.ObjectArray,
          headers: {[MetaHeader.Version]: Schema.String},
        },
      },
      resp: EmptyResponseCodec,
    },
    submitPoolAttesterSlashings: {
      url: "/eth/v1/beacon/pool/attester_slashings",
      method: "POST",
      req: {
        writeReqJson: ({attesterSlashing}) => ({body: ssz.phase0.AttesterSlashing.toJson(attesterSlashing)}),
        parseReqJson: ({body}) => ({attesterSlashing: ssz.phase0.AttesterSlashing.fromJson(body)}),
        writeReqSsz: ({attesterSlashing}) => ({body: ssz.phase0.AttesterSlashing.serialize(attesterSlashing)}),
        parseReqSsz: ({body}) => ({attesterSlashing: ssz.phase0.AttesterSlashing.deserialize(body)}),
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
        writeReqJson: ({proposerSlashing}) => ({body: ssz.phase0.ProposerSlashing.toJson(proposerSlashing)}),
        parseReqJson: ({body}) => ({proposerSlashing: ssz.phase0.ProposerSlashing.fromJson(body)}),
        writeReqSsz: ({proposerSlashing}) => ({body: ssz.phase0.ProposerSlashing.serialize(proposerSlashing)}),
        parseReqSsz: ({body}) => ({proposerSlashing: ssz.phase0.ProposerSlashing.deserialize(body)}),
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
        writeReqJson: ({signedVoluntaryExit}) => ({body: ssz.phase0.SignedVoluntaryExit.toJson(signedVoluntaryExit)}),
        parseReqJson: ({body}) => ({signedVoluntaryExit: ssz.phase0.SignedVoluntaryExit.fromJson(body)}),
        writeReqSsz: ({signedVoluntaryExit}) => ({body: ssz.phase0.SignedVoluntaryExit.serialize(signedVoluntaryExit)}),
        parseReqSsz: ({body}) => ({signedVoluntaryExit: ssz.phase0.SignedVoluntaryExit.deserialize(body)}),
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
        writeReqJson: ({blsToExecutionChanges}) => ({
          body: SignedBLSToExecutionChangeListType.toJson(blsToExecutionChanges),
        }),
        parseReqJson: ({body}) => ({blsToExecutionChanges: SignedBLSToExecutionChangeListType.fromJson(body)}),
        writeReqSsz: ({blsToExecutionChanges}) => ({
          body: SignedBLSToExecutionChangeListType.serialize(blsToExecutionChanges),
        }),
        parseReqSsz: ({body}) => ({blsToExecutionChanges: SignedBLSToExecutionChangeListType.deserialize(body)}),
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
}
