/* eslint-disable @typescript-eslint/naming-convention */
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {ssz, allForks, bellatrix, Slot, Root, BLSPubkey} from "@lodestar/types";
import {ForkName, isForkExecution, isForkBlobs, ForkSeq} from "@lodestar/params";
import {ChainForkConfig} from "@lodestar/config";

import {Endpoint, RouteDefinitions, Schema} from "../utils/index.js";
import {
  ArrayOf,
  EmptyArgs,
  EmptyGetRequestCodec,
  EmptyMeta,
  EmptyRequest,
  EmptyResponseCodec,
  EmptyResponseData,
  JsonOnlyReq,
  VersionCodec,
  VersionMeta,
  WithVersion,
} from "../utils/codecs.js";
import {toForkName} from "../utils/serdes.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

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
    allForks.SignedBuilderBid,
    VersionMeta
  >;

  submitBlindedBlock: Endpoint<
    "POST",
    {signedBlindedBlock: allForks.SignedBlindedBeaconBlock},
    {body: unknown; headers: {"Eth-Consensus-Version": string}},
    allForks.ExecutionPayload | allForks.ExecutionPayloadAndBlobsBundle,
    VersionMeta
  >;
};

/**
 * Define javascript values for each route
 */
export function getDefinitions(config: ChainForkConfig): RouteDefinitions<Endpoints> {
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
        data: WithVersion((fork: ForkName) =>
          // TODO: rather throw error here, defaulting to a different work type just cases ambiguous errors
          isForkExecution(fork) ? ssz.allForksExecution[fork].SignedBuilderBid : ssz.bellatrix.SignedBuilderBid
        ),
        meta: VersionCodec,
      },
    },
    submitBlindedBlock: {
      url: "/eth/v1/builder/blinded_blocks",
      method: "POST",
      req: {
        writeReqJson: (args) => {
          const slot = args.signedBlindedBlock.message.slot;
          return {
            body: config.getBlindedForkTypes(slot).SignedBeaconBlock.toJson(args.signedBlindedBlock),
            headers: {
              "Eth-Consensus-Version": config.getForkName(slot),
            },
          };
        },
        parseReqJson: ({body, headers}) => {
          const forkName = toForkName(headers["Eth-Consensus-Version"]); // TODO validation
          if (!isForkExecution(forkName)) throw new Error("TODO"); // TODO
          return {
            signedBlindedBlock: ssz[forkName].SignedBlindedBeaconBlock.fromJson(body),
          };
        },
        writeReqSsz: (args) => {
          const slot = args.signedBlindedBlock.message.slot;
          return {
            body: config.getBlindedForkTypes(slot).SignedBeaconBlock.serialize(args.signedBlindedBlock),
            headers: {
              "Eth-Consensus-Version": config.getForkName(slot),
            },
          };
        },
        parseReqSsz: ({body, headers}) => {
          const forkName = toForkName(headers["Eth-Consensus-Version"]); // TODO error if header does not exist
          const forkSeq = config.forks[forkName].seq;
          if (forkSeq < ForkSeq.bellatrix) throw new Error("TODO"); // TODO
          return {
            signedBlindedBlock: ssz[forkName as "bellatrix"].SignedBlindedBeaconBlock.deserialize(body),
          };
        },
        schema: {
          body: Schema.Object,
          headers: {"Eth-Consensus-Version": Schema.StringRequired},
        },
      },
      resp: {
        data: WithVersion<allForks.ExecutionPayload | allForks.ExecutionPayloadAndBlobsBundle, {version: ForkName}>(
          (fork: ForkName) =>
            isForkBlobs(fork)
              ? ssz.allForksBlobs[fork].ExecutionPayloadAndBlobsBundle
              : isForkExecution(fork)
                ? ssz.allForksExecution[fork].ExecutionPayload
                : ssz.bellatrix.ExecutionPayload
        ),
        meta: VersionCodec,
      },
    },
  };
}
