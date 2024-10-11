import {
  ssz,
  bellatrix,
  Slot,
  Root,
  BLSPubkey,
  ExecutionPayload,
  ExecutionPayloadAndBlobsBundle,
  SignedBlindedBeaconBlock,
  SignedBuilderBid,
} from "@lodestar/types";
import {ForkName, isForkBlobs} from "@lodestar/params";
import {ChainForkConfig} from "@lodestar/config";
import {fromHex, toPubkeyHex, toRootHex} from "@lodestar/utils";

import {Endpoint, RouteDefinitions, Schema} from "../utils/index.js";
import {MetaHeader, VersionCodec, VersionMeta} from "../utils/metadata.js";
import {
  ArrayOf,
  EmptyArgs,
  EmptyRequestCodec,
  EmptyMeta,
  EmptyRequest,
  EmptyResponseCodec,
  EmptyResponseData,
  JsonOnlyReq,
  WithVersion,
} from "../utils/codecs.js";
import {getBlobsForkTypes, getExecutionForkTypes, toForkName} from "../utils/fork.js";
import {fromHeaders} from "../utils/headers.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

// Mev-boost might not return any data if there are no bids from builders or min-bid threshold was not reached.
// In this case, we receive a success response (204) which is not handled as an error. The generic response
// handler already checks the status code and will not attempt to parse the body, but it will return no value.
// It is important that this type indicates that there might be no value to ensure it is properly handled downstream.
export type MaybeSignedBuilderBid = SignedBuilderBid | undefined;

const RegistrationsType = ArrayOf(ssz.bellatrix.SignedValidatorRegistrationV1);

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
    {signedBlindedBlock: SignedBlindedBeaconBlock},
    {body: unknown; headers: {[MetaHeader.Version]: string}},
    ExecutionPayload | ExecutionPayloadAndBlobsBundle,
    VersionMeta
  >;
};

// NOTE: Builder API does not support SSZ as per spec, need to keep routes as JSON-only for now
// See https://github.com/ethereum/builder-specs/issues/53 for more details

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
      req: JsonOnlyReq({
        writeReqJson: ({registrations}) => ({body: RegistrationsType.toJson(registrations)}),
        parseReqJson: ({body}) => ({registrations: RegistrationsType.fromJson(body)}),
        schema: {body: Schema.ObjectArray},
      }),
      resp: EmptyResponseCodec,
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
          (fork: ForkName) => getExecutionForkTypes(fork).SignedBuilderBid
        ),
        meta: VersionCodec,
      },
    },
    submitBlindedBlock: {
      url: "/eth/v1/builder/blinded_blocks",
      method: "POST",
      req: JsonOnlyReq({
        writeReqJson: ({signedBlindedBlock}) => {
          const fork = config.getForkName(signedBlindedBlock.message.slot);
          return {
            body: getExecutionForkTypes(fork).SignedBlindedBeaconBlock.toJson(signedBlindedBlock),
            headers: {
              [MetaHeader.Version]: fork,
            },
          };
        },
        parseReqJson: ({body, headers}) => {
          const fork = toForkName(fromHeaders(headers, MetaHeader.Version));
          return {
            signedBlindedBlock: getExecutionForkTypes(fork).SignedBlindedBeaconBlock.fromJson(body),
          };
        },
        schema: {
          body: Schema.Object,
          headers: {[MetaHeader.Version]: Schema.String},
        },
      }),
      resp: {
        data: WithVersion<ExecutionPayload | ExecutionPayloadAndBlobsBundle, VersionMeta>((fork: ForkName) => {
          return isForkBlobs(fork)
            ? getBlobsForkTypes(fork).ExecutionPayloadAndBlobsBundle
            : getExecutionForkTypes(fork).ExecutionPayload;
        }),
        meta: VersionCodec,
      },
    },
  };
}
