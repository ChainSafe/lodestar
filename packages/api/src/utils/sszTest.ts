/* eslint-disable @typescript-eslint/naming-convention */
import {ContainerType, ListBasicType, ListCompositeType, Type, ValueOf} from "@chainsafe/ssz";
import {Epoch, StringType, allForks, ssz} from "@lodestar/types";
import {StateId} from "../beacon/routes/beacon/index.js";
import {AttesterDuty} from "../beacon/routes/validator.js";
import {NodeHealthOptions} from "../beacon/routes/node.js";
import {Schema} from "./schema.js";
import {Endpoint, RouteDefinitions} from "./types.js";
import {
  EmptyArgs,
  EmptyGetRequestCodec,
  EmptyMeta,
  EmptyMetaCodec,
  EmptyRequest,
  EmptyResponseData,
  ExecutionOptimisticAndDependentRootMeta,
  ExecutionOptimisticAndDependentRootCodec,
  ExecutionOptimisticAndVersionMeta,
  ExecutionOptimisticAndVersionCodec,
  WithVersion,
  EmptyResponseCodec,
} from "./codecs.js";
import {createApiClientMethods} from "./client/method.js";
import {WireFormat} from "./headers.js";
import {IHttpClient} from "./client/httpClient.js";

// TODO: delete this file

// ssz types -- assumed to already be defined

const ValidatorIndices = new ListBasicType(ssz.ValidatorIndex, 2 ** 40);
const AttesterDuty = new ContainerType({
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
});
const AttesterDuties = new ListCompositeType(AttesterDuty, 2 ** 40);
const NodeVersion = new ContainerType({
  version: new StringType(),
});

type ValidatorIndicesType = ValueOf<typeof ValidatorIndices>;
type AttesterDutiesType = ValueOf<typeof AttesterDuties>;
type NodeVersionType = ValueOf<typeof NodeVersion>;

// Showing some usage of how to define routes - a GET and a POST

// First, Endpoints are defined.

export type TestEndpoints = {
  getState: Endpoint<
    "GET",
    {stateId: StateId},
    {params: {state_id: string}},
    allForks.BeaconState,
    ExecutionOptimisticAndVersionMeta
  >;
  getAttesterDuties: Endpoint<
    "POST",
    {epoch: Epoch; indices: ValidatorIndicesType},
    {params: {epoch: number}; body: string[]},
    AttesterDutiesType,
    ExecutionOptimisticAndDependentRootMeta
  >;
  getNodeVersion: Endpoint<
    //
    "GET",
    EmptyArgs,
    EmptyRequest,
    NodeVersionType,
    EmptyMeta
  >;
  getHealth: Endpoint<
    //
    "GET",
    NodeHealthOptions,
    {query: {syncing_status?: number}},
    EmptyResponseData,
    EmptyMeta
  >;
};

// Then route definitions

export const definitions: RouteDefinitions<TestEndpoints> = {
  getState: {
    url: "/eth/v2/debug/beacon/states/{state_id}",
    method: "GET",
    req: {
      writeReq: ({stateId}) => ({params: {state_id: String(stateId)}}),
      parseReq: ({params}) => ({stateId: params.state_id}),
      schema: {params: {state_id: Schema.StringRequired}},
    },
    resp: {
      // this is an example where respones metadata informs interpretation of the response data
      data: WithVersion((forkName) => ssz[forkName].BeaconState as Type<allForks.BeaconState>),
      meta: ExecutionOptimisticAndVersionCodec,
    },
  },
  getAttesterDuties: {
    url: "/eth/v1/validator/duties/attester/{epoch}",
    method: "POST",
    // POST request codecs include *Json functions to translate to / from json bodies and *Ssz functions to translate to / from ssz bodies
    req: {
      writeReqJson: ({epoch, indices}) => ({params: {epoch}, body: ValidatorIndices.toJson(indices) as string[]}),
      parseReqJson: ({params, body}) => ({epoch: params.epoch, indices: ValidatorIndices.fromJson(body)}),
      writeReqSsz: ({epoch, indices}) => ({params: {epoch}, body: ValidatorIndices.serialize(indices)}),
      parseReqSsz: ({params, body}) => ({epoch: params.epoch, indices: ValidatorIndices.deserialize(body)}),
      schema: {params: {epoch: Schema.UintRequired}, body: Schema.StringArray},
    },
    resp: {
      // A ssz type suffices in cases where the data shape is static
      data: AttesterDuties,
      meta: ExecutionOptimisticAndDependentRootCodec,
    },
  },
  getNodeVersion: {
    url: "/eth/v1/node/version",
    method: "GET",
    req: EmptyGetRequestCodec,
    resp: {
      data: NodeVersion,
      meta: EmptyMetaCodec,
    },
  },
  getHealth: {
    url: "/eth/v1/node/health",
    method: "GET",
    req: {
      parseReq: ({query}) => ({syncingStatus: query.syncing_status}),
      writeReq: ({syncingStatus}) => ({query: {syncing_status: syncingStatus}}),
      schema: {query: {syncing_status: Schema.Uint}},
    },
    resp: EmptyResponseCodec,
  },
};

// client defines default baseUrl, wire formats, additional headers, timeout, client-level abort-signal, etc.
const client = undefined as unknown as IHttpClient;
const testMethods = createApiClientMethods(definitions, client);

const args = {epoch: 0, indices: []};

const controller = new AbortController();
const resp = await testMethods.getAttesterDuties(args, {
  // optional request-specific overrides
  baseUrl: "https://other.com",
  responseWireFormat: WireFormat.ssz,
  signal: controller.signal,
  headers: {extra: "headers"},
  timeoutMs: 5000,
});

const _duties = await resp.value();

const res = await testMethods.getHealth();
await res.value();
