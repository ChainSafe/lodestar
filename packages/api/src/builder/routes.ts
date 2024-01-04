/* eslint-disable @typescript-eslint/naming-convention */
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {ssz, allForks, bellatrix, Slot, Root, BLSPubkey} from "@lodestar/types";
import {ForkName, isForkExecution, isForkBlobs, ForkSeq} from "@lodestar/params";
import {ChainForkConfig} from "@lodestar/config";

import {AnyGetEndpoint, AnyPostEndpoint, Endpoint, ResponseCodec, RouteDefinitions, Schema} from "../utils/index.js";
import {
  ArrayOf,
  EmptyArgs,
  EmptyGetRequestCodec,
  EmptyMeta,
  EmptyRequest,
  EmptyResponseCodec,
  EmptyResponseData,
  VersionCodec,
  VersionMeta,
  WithVersion,
} from "../utils/codecs.js";
import {WireFormat} from "../utils/headers.js";

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
    {body: unknown; headers: {"Eth-Consensus-Version": ForkName}},
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
      resp: EmptyResponseCodec as ResponseCodec<AnyGetEndpoint>,
    },
    registerValidator: {
      url: "/eth/v1/builder/validators",
      method: "POST",
      req: {
        writeReqJson: ({registrations}) => ({body: RegistrationsType.toJson(registrations)}),
        parseReqJson: ({body}) => ({registrations: RegistrationsType.fromJson(body)}),
        writeReqSsz: () => {
          throw new Error("Not implemented");
        },
        parseReqSsz: () => {
          throw new Error("Not implemented");
        },
        schema: {body: Schema.ObjectArray},
        onlySupport: WireFormat.json,
      },
      resp: EmptyResponseCodec as ResponseCodec<AnyPostEndpoint>,
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
          const forkName = headers["Eth-Consensus-Version"]; // TODO validation
          const forkSeq = config.forks[forkName].seq;
          if (forkSeq < ForkSeq.capella) throw new Error("TODO"); // TODO
          return {
            signedBlindedBlock: ssz[forkName as "capella"].SignedBlindedBeaconBlock.fromJson(body),
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
          const forkName = headers["Eth-Consensus-Version"]; // TODO validation
          const forkSeq = config.forks[forkName].seq;
          if (forkSeq < ForkSeq.capella) throw new Error("TODO"); // TODO
          return {
            signedBlindedBlock: ssz[forkName as "capella"].SignedBlindedBeaconBlock.deserialize(body),
          };
        },
        schema: {
          body: Schema.Object,
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
