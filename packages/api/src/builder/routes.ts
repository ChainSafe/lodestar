/* eslint-disable @typescript-eslint/naming-convention */
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {ssz, allForks, bellatrix, Slot, Root, BLSPubkey} from "@lodestar/types";
import {ForkName, isForkExecution, isForkBlobs} from "@lodestar/params";
import {ChainForkConfig} from "@lodestar/config";

import {Endpoint, RouteDefinitions, Schema} from "../utils/index.js";
import {MetaHeader, VersionCodec, VersionMeta} from "../utils/metadata.js";
import {
  ArrayOf,
  EmptyArgs,
  EmptyGetRequestCodec,
  EmptyMeta,
  EmptyRequest,
  EmptyResponseCodec,
  EmptyResponseData,
  JsonOnlyReq,
  WithVersion,
} from "../utils/codecs.js";
import {toForkName} from "../utils/serdes.js";
import {fromHeaders} from "../utils/headers.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

// Mev-boost might not return any data if there are no bids from builders or min-bid threshold was not reached.
// In this case, we receive a success response (204) which is not handled as an error. The generic response
// handler already checks the status code and will not attempt to parse the body, but it will return no value.
// It is important that this type indicates that there might be no value to ensure it is properly handled downstream.
type MaybeSignedBuilderBid = allForks.SignedBuilderBid | undefined;

const RegistrationsType = ArrayOf(ssz.bellatrix.SignedValidatorRegistrationV1);

export type Endpoints = {
  status: Endpoint<
    //
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
    {signedBlindedBlock: allForks.SignedBlindedBeaconBlock},
    {body: unknown; headers: {[MetaHeader.Version]: string}},
    allForks.ExecutionPayload | allForks.ExecutionPayloadAndBlobsBundle,
    VersionMeta
  >;
};

/**
 * Define javascript values for each route
 */
export function definitions(config: ChainForkConfig): RouteDefinitions<Endpoints> {
  return {
    status: {
      url: "/eth/v1/builder/status",
      method: "GET",
      req: EmptyGetRequestCodec,
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
          params: {slot, parent_hash: toHexString(parentHash), pubkey: toHexString(proposerPubKey)},
        }),
        parseReq: ({params}) => ({
          slot: params.slot,
          parentHash: fromHexString(params.parent_hash),
          proposerPubkey: fromHexString(params.pubkey),
        }),
        schema: {
          params: {slot: Schema.UintRequired, parent_hash: Schema.StringRequired, pubkey: Schema.StringRequired},
        },
      },
      resp: {
        data: WithVersion<MaybeSignedBuilderBid, VersionMeta>((fork: ForkName) => {
          if (!isForkExecution(fork)) throw new Error("TODO"); // TODO

          return ssz.allForksExecution[fork].SignedBuilderBid;
        }),
        meta: VersionCodec,
      },
    },
    submitBlindedBlock: {
      url: "/eth/v1/builder/blinded_blocks",
      method: "POST",
      req: JsonOnlyReq({
        writeReqJson: (args) => {
          const slot = args.signedBlindedBlock.message.slot;
          return {
            body: config.getBlindedForkTypes(slot).SignedBeaconBlock.toJson(args.signedBlindedBlock),
            headers: {
              [MetaHeader.Version]: config.getForkName(slot),
            },
          };
        },
        parseReqJson: ({body, headers}) => {
          const forkName = toForkName(fromHeaders(headers, MetaHeader.Version));
          if (!isForkExecution(forkName)) throw new Error("TODO"); // TODO
          return {
            signedBlindedBlock: ssz[forkName].SignedBlindedBeaconBlock.fromJson(body),
          };
        },
        schema: {
          body: Schema.Object,
          headers: {[MetaHeader.Version]: Schema.StringRequired},
        },
      }),
      resp: {
        data: WithVersion<allForks.ExecutionPayload | allForks.ExecutionPayloadAndBlobsBundle, {version: ForkName}>(
          (fork: ForkName) => {
            if (!isForkExecution(fork)) throw new Error("TODO"); // TODO

            return isForkBlobs(fork)
              ? ssz.allForksBlobs[fork].ExecutionPayloadAndBlobsBundle
              : ssz.allForksExecution[fork].ExecutionPayload;
          }
        ),
        meta: VersionCodec,
      },
    },
  };
}
