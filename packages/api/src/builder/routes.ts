import {ChainForkConfig} from "@lodestar/config";
import {ForkName, VALIDATOR_REGISTRY_LIMIT, isForkPostDeneb} from "@lodestar/params";
import {
  BLSPubkey,
  ExecutionPayload,
  ExecutionPayloadAndBlobsBundle,
  Root,
  SignedBlindedBeaconBlock,
  SignedBuilderBid,
  Slot,
  WithOptionalBytes,
  bellatrix,
  ssz,
} from "@lodestar/types";
import {fromHex, toPubkeyHex, toRootHex} from "@lodestar/utils";

import {
  ArrayOf,
  EmptyArgs,
  EmptyMeta,
  EmptyRequest,
  EmptyRequestCodec,
  EmptyResponseCodec,
  EmptyResponseData,
  WithVersion,
} from "../utils/codecs.js";
import {getPostBellatrixForkTypes, getPostDenebForkTypes, toForkName} from "../utils/fork.js";
import {fromHeaders} from "../utils/headers.js";
import {Endpoint, RouteDefinitions, Schema} from "../utils/index.js";
import {MetaHeader, VersionCodec, VersionMeta} from "../utils/metadata.js";
import {WireFormat} from "../utils/wireFormat.js";

// Mev-boost might not return any data if there are no bids from builders or min-bid threshold was not reached.
// In this case, we receive a success response (204) which is not handled as an error. The generic response
// handler already checks the status code and will not attempt to parse the body, but it will return no value.
// It is important that this type indicates that there might be no value to ensure it is properly handled downstream.
export type MaybeSignedBuilderBid = SignedBuilderBid | undefined;

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
  };
}
