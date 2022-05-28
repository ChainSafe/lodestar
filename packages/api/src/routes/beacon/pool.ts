import {phase0, altair, CommitteeIndex, Slot, ssz} from "@chainsafe/lodestar-types";
import {
  RoutesData,
  ReturnTypes,
  ArrayOf,
  ContainerData,
  Schema,
  reqOnlyBody,
  ReqSerializers,
  reqEmpty,
  ReqEmpty,
} from "../../utils/index.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type AttestationFilters = {
  slot: Slot;
  committeeIndex: CommitteeIndex;
};

export type Api = {
  /**
   * Get Attestations from operations pool
   * Retrieves attestations known by the node but not necessarily incorporated into any block
   * @param slot
   * @param committeeIndex
   * @returns any Successful response
   * @throws ApiError
   */
  getPoolAttestations(filters?: Partial<AttestationFilters>): Promise<{data: phase0.Attestation[]}>;

  /**
   * Get AttesterSlashings from operations pool
   * Retrieves attester slashings known by the node but not necessarily incorporated into any block
   * @returns any Successful response
   * @throws ApiError
   */
  getPoolAttesterSlashings(): Promise<{data: phase0.AttesterSlashing[]}>;

  /**
   * Get ProposerSlashings from operations pool
   * Retrieves proposer slashings known by the node but not necessarily incorporated into any block
   * @returns any Successful response
   * @throws ApiError
   */
  getPoolProposerSlashings(): Promise<{data: phase0.ProposerSlashing[]}>;

  /**
   * Get SignedVoluntaryExit from operations pool
   * Retrieves voluntary exits known by the node but not necessarily incorporated into any block
   * @returns any Successful response
   * @throws ApiError
   */
  getPoolVoluntaryExits(): Promise<{data: phase0.SignedVoluntaryExit[]}>;

  /**
   * Submit Attestation objects to node
   * Submits Attestation objects to the node.  Each attestation in the request body is processed individually.
   *
   * If an attestation is validated successfully the node MUST publish that attestation on the appropriate subnet.
   *
   * If one or more attestations fail validation the node MUST return a 400 error with details of which attestations have failed, and why.
   *
   * @param requestBody
   * @returns any Attestations are stored in pool and broadcast on appropriate subnet
   * @throws ApiError
   */
  submitPoolAttestations(attestations: phase0.Attestation[]): Promise<void>;

  /**
   * Submit AttesterSlashing object to node's pool
   * Submits AttesterSlashing object to node's pool and if passes validation node MUST broadcast it to network.
   * @param requestBody
   * @returns any Success
   * @throws ApiError
   */
  submitPoolAttesterSlashing(slashing: phase0.AttesterSlashing): Promise<void>;

  /**
   * Submit ProposerSlashing object to node's pool
   * Submits ProposerSlashing object to node's pool and if passes validation  node MUST broadcast it to network.
   * @param requestBody
   * @returns any Success
   * @throws ApiError
   */
  submitPoolProposerSlashing(slashing: phase0.ProposerSlashing): Promise<void>;

  /**
   * Submit SignedVoluntaryExit object to node's pool
   * Submits SignedVoluntaryExit object to node's pool and if passes validation node MUST broadcast it to network.
   * @param requestBody
   * @returns any Voluntary exit is stored in node and broadcasted to network
   * @throws ApiError
   */
  submitPoolVoluntaryExit(exit: phase0.SignedVoluntaryExit): Promise<void>;

  /**
   * TODO: Add description
   */
  submitPoolSyncCommitteeSignatures(signatures: altair.SyncCommitteeMessage[]): Promise<void>;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getPoolAttestations: {url: "/eth/v1/beacon/pool/attestations", method: "GET"},
  getPoolAttesterSlashings: {url: "/eth/v1/beacon/pool/attester_slashings", method: "GET"},
  getPoolProposerSlashings: {url: "/eth/v1/beacon/pool/proposer_slashings", method: "GET"},
  getPoolVoluntaryExits: {url: "/eth/v1/beacon/pool/voluntary_exits", method: "GET"},
  submitPoolAttestations: {url: "/eth/v1/beacon/pool/attestations", method: "POST"},
  submitPoolAttesterSlashing: {url: "/eth/v1/beacon/pool/attester_slashings", method: "POST"},
  submitPoolProposerSlashing: {url: "/eth/v1/beacon/pool/proposer_slashings", method: "POST"},
  submitPoolVoluntaryExit: {url: "/eth/v1/beacon/pool/voluntary_exits", method: "POST"},
  submitPoolSyncCommitteeSignatures: {url: "/eth/v1/beacon/pool/sync_committees", method: "POST"},
};

/* eslint-disable @typescript-eslint/naming-convention */
export type ReqTypes = {
  getPoolAttestations: {query: {slot?: number; committee_index?: number}};
  getPoolAttesterSlashings: ReqEmpty;
  getPoolProposerSlashings: ReqEmpty;
  getPoolVoluntaryExits: ReqEmpty;
  submitPoolAttestations: {body: unknown};
  submitPoolAttesterSlashing: {body: unknown};
  submitPoolProposerSlashing: {body: unknown};
  submitPoolVoluntaryExit: {body: unknown};
  submitPoolSyncCommitteeSignatures: {body: unknown};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  return {
    getPoolAttestations: {
      writeReq: (filters) => ({query: {slot: filters?.slot, committee_index: filters?.committeeIndex}}),
      parseReq: ({query}) => [{slot: query.slot, committeeIndex: query.committee_index}],
      schema: {query: {slot: Schema.Uint, committee_index: Schema.Uint}},
    },
    getPoolAttesterSlashings: reqEmpty,
    getPoolProposerSlashings: reqEmpty,
    getPoolVoluntaryExits: reqEmpty,
    submitPoolAttestations: reqOnlyBody(ArrayOf(ssz.phase0.Attestation), Schema.ObjectArray),
    submitPoolAttesterSlashing: reqOnlyBody(ssz.phase0.AttesterSlashing, Schema.Object),
    submitPoolProposerSlashing: reqOnlyBody(ssz.phase0.ProposerSlashing, Schema.Object),
    submitPoolVoluntaryExit: reqOnlyBody(ssz.phase0.SignedVoluntaryExit, Schema.Object),
    submitPoolSyncCommitteeSignatures: reqOnlyBody(ArrayOf(ssz.altair.SyncCommitteeMessage), Schema.ObjectArray),
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  return {
    getPoolAttestations: ContainerData(ArrayOf(ssz.phase0.Attestation)),
    getPoolAttesterSlashings: ContainerData(ArrayOf(ssz.phase0.AttesterSlashing)),
    getPoolProposerSlashings: ContainerData(ArrayOf(ssz.phase0.ProposerSlashing)),
    getPoolVoluntaryExits: ContainerData(ArrayOf(ssz.phase0.SignedVoluntaryExit)),
  };
}
