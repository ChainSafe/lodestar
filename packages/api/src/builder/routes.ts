import {ChainForkConfig} from "@lodestar/config";
import {ForkName, ForkPostGloas, VALIDATOR_REGISTRY_LIMIT, isForkPostDeneb} from "@lodestar/params";
import {
  ArrayOf,
  BLSPubkey,
  ExecutionPayload,
  ExecutionPayloadAndBlobsBundle,
  Root,
  SignedBeaconBlock,
  SignedBlindedBeaconBlock,
  SignedBuilderBid,
  Slot,
  WithOptionalBytes,
  bellatrix,
  gloas,
  ssz,
} from "@lodestar/types";
import {fromHex, toPubkeyHex, toRootHex} from "@lodestar/utils";
import {
  EmptyArgs,
  EmptyMeta,
  EmptyRequest,
  EmptyRequestCodec,
  EmptyResponseCodec,
  EmptyResponseData,
  WithVersion,
} from "../utils/codecs.js";
import {getPostBellatrixForkTypes, getPostDenebForkTypes, getPostGloasForkTypes, toForkName} from "../utils/fork.js";
import {fromHeaders} from "../utils/headers.js";
import {Endpoint, RouteDefinitions, Schema} from "../utils/index.js";
import {MetaHeader, VersionCodec, VersionMeta} from "../utils/metadata.js";
import {WireFormat} from "../utils/wireFormat.js";

// Mev-boost might not return any data if there are no bids from builders or min-bid threshold was not reached.
// In this case, we receive a success response (204) which is not handled as an error. The generic response
// handler already checks the status code and will not attempt to parse the body, but it will return no value.
// It is important that this type indicates that there might be no value to ensure it is properly handled downstream.
export type MaybeSignedBuilderBid = SignedBuilderBid | undefined;

// Same as `MaybeSignedBuilderBid`, the builder responds with 204 if no bid is available
export type MaybeSignedExecutionPayloadBid = gloas.SignedExecutionPayloadBid | undefined;

const RegistrationsType = ArrayOf(ssz.bellatrix.SignedValidatorRegistrationV1, VALIDATOR_REGISTRY_LIMIT);

export type Endpoints = {
  status: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    EmptyResponseData,
    EmptyMeta
  >;

  registerValidator: Endpoint<
    "POST",
    {registrations: bellatrix.SignedValidatorRegistrationV1[]},
    {body: unknown},
    EmptyResponseData,
    EmptyMeta
  >;

  getHeader: Endpoint<
    "GET",
    {
      slot: Slot;
      parentHash: Root;
      proposerPubkey: BLSPubkey;
    },
    {params: {slot: Slot; parent_hash: string; pubkey: string}},
    MaybeSignedBuilderBid,
    VersionMeta
  >;

  submitBlindedBlock: Endpoint<
    "POST",
    {signedBlindedBlock: WithOptionalBytes<SignedBlindedBeaconBlock>},
    {body: unknown; headers: {[MetaHeader.Version]: string}},
    ExecutionPayload | ExecutionPayloadAndBlobsBundle,
    VersionMeta
  >;

  submitBlindedBlockV2: Endpoint<
    "POST",
    {signedBlindedBlock: WithOptionalBytes<SignedBlindedBeaconBlock>},
    {body: unknown; headers: {[MetaHeader.Version]: string}},
    EmptyResponseData,
    EmptyMeta
  >;

  getExecutionPayloadBid: Endpoint<
    "POST",
    {
      slot: Slot;
      parentHash: Root;
      parentRoot: Root;
      proposerPubkey: BLSPubkey;
      /** Authenticates the requesting proposer to the builder */
      requestAuth: gloas.SignedRequestAuth;
      /** Unix timestamp in milliseconds at which the request was sent */
      dateMilliseconds: number;
      /** The proposer's timeout for the request in milliseconds, measured from `dateMilliseconds` */
      timeoutMs: number;
    },
    {
      params: {slot: Slot; parent_hash: string; parent_root: string; proposer_pubkey: string};
      body: unknown;
      headers: {[MetaHeader.Version]: string; [MetaHeader.DateMilliseconds]: string; [MetaHeader.TimeoutMs]: string};
    },
    MaybeSignedExecutionPayloadBid,
    VersionMeta
  >;

  submitSignedBeaconBlock: Endpoint<
    "POST",
    {signedBlock: WithOptionalBytes<SignedBeaconBlock<ForkPostGloas>>},
    {body: unknown; headers: {[MetaHeader.Version]: string}},
    EmptyResponseData,
    EmptyMeta
  >;

  submitBuilderPreferences: Endpoint<
    "POST",
    {proposerPubkey: BLSPubkey; request: gloas.BuilderPreferencesRequest},
    {params: {proposer_pubkey: string}; body: unknown; headers: {[MetaHeader.Version]: string}},
    EmptyResponseData,
    EmptyMeta
  >;
};

export function getDefinitions(config: ChainForkConfig): RouteDefinitions<Endpoints> {
  return {
    status: {
      url: "/eth/v1/builder/status",
      method: "GET",
      req: EmptyRequestCodec,
      resp: EmptyResponseCodec,
    },
    registerValidator: {
      url: "/eth/v1/builder/validators",
      method: "POST",
      req: {
        writeReqJson: ({registrations}) => ({body: RegistrationsType.toJson(registrations)}),
        parseReqJson: ({body}) => ({registrations: RegistrationsType.fromJson(body)}),
        writeReqSsz: ({registrations}) => ({body: RegistrationsType.serialize(registrations)}),
        parseReqSsz: ({body}) => ({registrations: RegistrationsType.deserialize(body)}),
        schema: {body: Schema.ObjectArray},
      },
      resp: EmptyResponseCodec,
      init: {
        requestWireFormat: WireFormat.ssz,
      },
    },
    getHeader: {
      url: "/eth/v1/builder/header/{slot}/{parent_hash}/{pubkey}",
      method: "GET",
      req: {
        writeReq: ({slot, parentHash, proposerPubkey: proposerPubKey}) => ({
          params: {slot, parent_hash: toRootHex(parentHash), pubkey: toPubkeyHex(proposerPubKey)},
        }),
        parseReq: ({params}) => ({
          slot: params.slot,
          parentHash: fromHex(params.parent_hash),
          proposerPubkey: fromHex(params.pubkey),
        }),
        schema: {
          params: {slot: Schema.UintRequired, parent_hash: Schema.StringRequired, pubkey: Schema.StringRequired},
        },
      },
      resp: {
        data: WithVersion<MaybeSignedBuilderBid, VersionMeta>(
          (fork: ForkName) => getPostBellatrixForkTypes(fork).SignedBuilderBid
        ),
        meta: VersionCodec,
      },
    },
    submitBlindedBlock: {
      url: "/eth/v1/builder/blinded_blocks",
      method: "POST",
      req: {
        writeReqJson: ({signedBlindedBlock}) => {
          const fork = config.getForkName(signedBlindedBlock.data.message.slot);
          return {
            body: getPostBellatrixForkTypes(fork).SignedBlindedBeaconBlock.toJson(signedBlindedBlock.data),
            headers: {
              [MetaHeader.Version]: fork,
            },
          };
        },
        parseReqJson: ({body, headers}) => {
          const fork = toForkName(fromHeaders(headers, MetaHeader.Version));
          return {
            signedBlindedBlock: {data: getPostBellatrixForkTypes(fork).SignedBlindedBeaconBlock.fromJson(body)},
          };
        },
        writeReqSsz: ({signedBlindedBlock}) => {
          const fork = config.getForkName(signedBlindedBlock.data.message.slot);
          return {
            body:
              signedBlindedBlock.bytes ??
              getPostBellatrixForkTypes(fork).SignedBlindedBeaconBlock.serialize(signedBlindedBlock.data),
            headers: {
              [MetaHeader.Version]: fork,
            },
          };
        },
        parseReqSsz: ({body, headers}) => {
          const fork = toForkName(fromHeaders(headers, MetaHeader.Version));
          return {
            signedBlindedBlock: {data: getPostBellatrixForkTypes(fork).SignedBlindedBeaconBlock.deserialize(body)},
          };
        },
        schema: {
          body: Schema.Object,
          headers: {[MetaHeader.Version]: Schema.String},
        },
      },
      resp: {
        data: WithVersion<ExecutionPayload | ExecutionPayloadAndBlobsBundle, VersionMeta>((fork: ForkName) => {
          return isForkPostDeneb(fork)
            ? getPostDenebForkTypes(fork).ExecutionPayloadAndBlobsBundle
            : getPostBellatrixForkTypes(fork).ExecutionPayload;
        }),
        meta: VersionCodec,
      },
    },
    submitBlindedBlockV2: {
      url: "/eth/v2/builder/blinded_blocks",
      method: "POST",
      req: {
        writeReqJson: ({signedBlindedBlock}) => {
          const fork = config.getForkName(signedBlindedBlock.data.message.slot);
          return {
            body: getPostBellatrixForkTypes(fork).SignedBlindedBeaconBlock.toJson(signedBlindedBlock.data),
            headers: {
              [MetaHeader.Version]: fork,
            },
          };
        },
        parseReqJson: ({body, headers}) => {
          const fork = toForkName(fromHeaders(headers, MetaHeader.Version));
          return {
            signedBlindedBlock: {data: getPostBellatrixForkTypes(fork).SignedBlindedBeaconBlock.fromJson(body)},
          };
        },
        writeReqSsz: ({signedBlindedBlock}) => {
          const fork = config.getForkName(signedBlindedBlock.data.message.slot);
          return {
            body:
              signedBlindedBlock.bytes ??
              getPostBellatrixForkTypes(fork).SignedBlindedBeaconBlock.serialize(signedBlindedBlock.data),
            headers: {
              [MetaHeader.Version]: fork,
            },
          };
        },
        parseReqSsz: ({body, headers}) => {
          const fork = toForkName(fromHeaders(headers, MetaHeader.Version));
          return {
            signedBlindedBlock: {data: getPostBellatrixForkTypes(fork).SignedBlindedBeaconBlock.deserialize(body)},
          };
        },
        schema: {
          body: Schema.Object,
          headers: {[MetaHeader.Version]: Schema.String},
        },
      },
      resp: EmptyResponseCodec,
    },
    getExecutionPayloadBid: {
      url: "/eth/v1/builder/execution_payload_bid/{slot}/{parent_hash}/{parent_root}/{proposer_pubkey}",
      method: "POST",
      req: {
        writeReqJson: ({slot, parentHash, parentRoot, proposerPubkey, requestAuth, dateMilliseconds, timeoutMs}) => ({
          params: {
            slot,
            parent_hash: toRootHex(parentHash),
            parent_root: toRootHex(parentRoot),
            proposer_pubkey: toPubkeyHex(proposerPubkey),
          },
          body: ssz.gloas.SignedRequestAuth.toJson(requestAuth),
          headers: {
            [MetaHeader.Version]: config.getForkName(slot),
            [MetaHeader.DateMilliseconds]: dateMilliseconds.toString(),
            [MetaHeader.TimeoutMs]: timeoutMs.toString(),
          },
        }),
        parseReqJson: ({params, body, headers}) => {
          toForkName(fromHeaders(headers, MetaHeader.Version));
          return {
            slot: params.slot,
            parentHash: fromHex(params.parent_hash),
            parentRoot: fromHex(params.parent_root),
            proposerPubkey: fromHex(params.proposer_pubkey),
            requestAuth: ssz.gloas.SignedRequestAuth.fromJson(body),
            dateMilliseconds: parseRequiredUintHeader(
              fromHeaders(headers, MetaHeader.DateMilliseconds),
              MetaHeader.DateMilliseconds
            ),
            timeoutMs: parseRequiredUintHeader(fromHeaders(headers, MetaHeader.TimeoutMs), MetaHeader.TimeoutMs),
          };
        },
        writeReqSsz: ({slot, parentHash, parentRoot, proposerPubkey, requestAuth, dateMilliseconds, timeoutMs}) => ({
          params: {
            slot,
            parent_hash: toRootHex(parentHash),
            parent_root: toRootHex(parentRoot),
            proposer_pubkey: toPubkeyHex(proposerPubkey),
          },
          body: ssz.gloas.SignedRequestAuth.serialize(requestAuth),
          headers: {
            [MetaHeader.Version]: config.getForkName(slot),
            [MetaHeader.DateMilliseconds]: dateMilliseconds.toString(),
            [MetaHeader.TimeoutMs]: timeoutMs.toString(),
          },
        }),
        parseReqSsz: ({params, body, headers}) => {
          toForkName(fromHeaders(headers, MetaHeader.Version));
          return {
            slot: params.slot,
            parentHash: fromHex(params.parent_hash),
            parentRoot: fromHex(params.parent_root),
            proposerPubkey: fromHex(params.proposer_pubkey),
            requestAuth: ssz.gloas.SignedRequestAuth.deserialize(body),
            dateMilliseconds: parseRequiredUintHeader(
              fromHeaders(headers, MetaHeader.DateMilliseconds),
              MetaHeader.DateMilliseconds
            ),
            timeoutMs: parseRequiredUintHeader(fromHeaders(headers, MetaHeader.TimeoutMs), MetaHeader.TimeoutMs),
          };
        },
        schema: {
          params: {
            slot: Schema.UintRequired,
            parent_hash: Schema.StringRequired,
            parent_root: Schema.StringRequired,
            proposer_pubkey: Schema.StringRequired,
          },
          body: Schema.Object,
          headers: {
            [MetaHeader.Version]: Schema.String,
            [MetaHeader.DateMilliseconds]: Schema.String,
            [MetaHeader.TimeoutMs]: Schema.String,
          },
        },
      },
      resp: {
        data: WithVersion<MaybeSignedExecutionPayloadBid, VersionMeta>(
          (fork: ForkName) => getPostGloasForkTypes(fork).SignedExecutionPayloadBid
        ),
        meta: VersionCodec,
      },
      init: {
        requestWireFormat: WireFormat.ssz,
      },
    },
    submitSignedBeaconBlock: {
      url: "/eth/v1/builder/beacon_blocks",
      method: "POST",
      req: {
        writeReqJson: ({signedBlock}) => {
          const fork = config.getForkName(signedBlock.data.message.slot);
          return {
            body: getPostGloasForkTypes(fork).SignedBeaconBlock.toJson(signedBlock.data),
            headers: {
              [MetaHeader.Version]: fork,
            },
          };
        },
        parseReqJson: ({body, headers}) => {
          const fork = toForkName(fromHeaders(headers, MetaHeader.Version));
          return {
            signedBlock: {data: getPostGloasForkTypes(fork).SignedBeaconBlock.fromJson(body)},
          };
        },
        writeReqSsz: ({signedBlock}) => {
          const fork = config.getForkName(signedBlock.data.message.slot);
          return {
            body: signedBlock.bytes ?? getPostGloasForkTypes(fork).SignedBeaconBlock.serialize(signedBlock.data),
            headers: {
              [MetaHeader.Version]: fork,
            },
          };
        },
        parseReqSsz: ({body, headers}) => {
          const fork = toForkName(fromHeaders(headers, MetaHeader.Version));
          return {
            signedBlock: {data: getPostGloasForkTypes(fork).SignedBeaconBlock.deserialize(body)},
          };
        },
        schema: {
          body: Schema.Object,
          headers: {[MetaHeader.Version]: Schema.String},
        },
      },
      resp: EmptyResponseCodec,
      init: {
        requestWireFormat: WireFormat.ssz,
      },
    },
    submitBuilderPreferences: {
      url: "/eth/v1/builder/builder_preferences/{proposer_pubkey}",
      method: "POST",
      req: {
        writeReqJson: ({proposerPubkey, request}) => ({
          params: {proposer_pubkey: toPubkeyHex(proposerPubkey)},
          body: ssz.gloas.BuilderPreferencesRequest.toJson(request),
          headers: {[MetaHeader.Version]: config.getForkName(request.auth.message.slot)},
        }),
        parseReqJson: ({params, body, headers}) => {
          toForkName(fromHeaders(headers, MetaHeader.Version));
          return {
            proposerPubkey: fromHex(params.proposer_pubkey),
            request: ssz.gloas.BuilderPreferencesRequest.fromJson(body),
          };
        },
        writeReqSsz: ({proposerPubkey, request}) => ({
          params: {proposer_pubkey: toPubkeyHex(proposerPubkey)},
          body: ssz.gloas.BuilderPreferencesRequest.serialize(request),
          headers: {[MetaHeader.Version]: config.getForkName(request.auth.message.slot)},
        }),
        parseReqSsz: ({params, body, headers}) => {
          toForkName(fromHeaders(headers, MetaHeader.Version));
          return {
            proposerPubkey: fromHex(params.proposer_pubkey),
            request: ssz.gloas.BuilderPreferencesRequest.deserialize(body),
          };
        },
        schema: {
          params: {proposer_pubkey: Schema.StringRequired},
          body: Schema.Object,
          headers: {[MetaHeader.Version]: Schema.String},
        },
      },
      resp: EmptyResponseCodec,
      init: {
        requestWireFormat: WireFormat.ssz,
      },
    },
  };
}

function parseRequiredUintHeader(value: string, header: MetaHeader): number {
  if (!/^\d+$/.test(value)) {
    throw Error(`${header} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw Error(`${header} must be a safe integer`);
  }
  return parsed;
}
