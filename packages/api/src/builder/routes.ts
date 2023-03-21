import {ssz, allForks, bellatrix, Slot, Root, BLSPubkey} from "@lodestar/types";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {ForkName, isForkExecution, isForkBlobs} from "@lodestar/params";
import {ChainForkConfig} from "@lodestar/config";

import {
  ReturnTypes,
  RoutesData,
  Schema,
  ReqSerializers,
  reqOnlyBody,
  reqEmpty,
  ReqEmpty,
  ArrayOf,
  WithVersion,
} from "../utils/index.js";
// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes
import {getReqSerializers as getBeaconReqSerializers} from "../beacon/routes/beacon/block.js";
import {HttpStatusCode} from "../utils/client/httpStatusCode.js";
import {ApiClientResponse} from "../interfaces.js";

export type Api = {
  status(): Promise<ApiClientResponse<{[HttpStatusCode.OK]: void}, HttpStatusCode.SERVICE_UNAVAILABLE>>;
  registerValidator(
    registrations: bellatrix.SignedValidatorRegistrationV1[]
  ): Promise<ApiClientResponse<{[HttpStatusCode.OK]: void}, HttpStatusCode.BAD_REQUEST>>;
  getHeader(
    slot: Slot,
    parentHash: Root,
    proposerPubKey: BLSPubkey
  ): Promise<
    ApiClientResponse<
      {[HttpStatusCode.OK]: {data: allForks.SignedBuilderBid; version: ForkName}},
      HttpStatusCode.NOT_FOUND | HttpStatusCode.BAD_REQUEST
    >
  >;
  submitBlindedBlock(
    signedBlock: allForks.SignedBlindedBeaconBlock
  ): Promise<
    ApiClientResponse<
      {[HttpStatusCode.OK]: {data: allForks.ExecutionPayload; version: ForkName}},
      HttpStatusCode.SERVICE_UNAVAILABLE
    >
  >;
  submitBlindedBlockV2(
    signedBlock: allForks.SignedBlindedBeaconBlock
  ): Promise<
    ApiClientResponse<
      {[HttpStatusCode.OK]: {data: allForks.SignedBeaconBlockAndBlobsSidecar; version: ForkName}},
      HttpStatusCode.SERVICE_UNAVAILABLE
    >
  >;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  status: {url: "/eth/v1/builder/status", method: "GET"},
  registerValidator: {url: "/eth/v1/builder/validators", method: "POST"},
  getHeader: {url: "/eth/v1/builder/header/{slot}/{parent_hash}/{pubkey}", method: "GET"},
  submitBlindedBlock: {url: "/eth/v1/builder/blinded_blocks", method: "POST"},
  submitBlindedBlockV2: {url: "/eth/v2/builder/blinded_blocks", method: "POST"},
};

/* eslint-disable @typescript-eslint/naming-convention */
export type ReqTypes = {
  status: ReqEmpty;
  registerValidator: {body: unknown};
  getHeader: {params: {slot: Slot; parent_hash: string; pubkey: string}};
  submitBlindedBlock: {body: unknown};
  submitBlindedBlockV2: {body: unknown};
};

export function getReqSerializers(config: ChainForkConfig): ReqSerializers<Api, ReqTypes> {
  return {
    status: reqEmpty,
    registerValidator: reqOnlyBody(ArrayOf(ssz.bellatrix.SignedValidatorRegistrationV1), Schema.ObjectArray),
    getHeader: {
      writeReq: (slot, parentHash, proposerPubKey) => ({
        params: {slot, parent_hash: toHexString(parentHash), pubkey: toHexString(proposerPubKey)},
      }),
      parseReq: ({params}) => [params.slot, fromHexString(params.parent_hash), fromHexString(params.pubkey)],
      schema: {
        params: {slot: Schema.UintRequired, parent_hash: Schema.StringRequired, pubkey: Schema.StringRequired},
      },
    },
    submitBlindedBlock: getBeaconReqSerializers(config)["publishBlindedBlock"],
    submitBlindedBlockV2: getBeaconReqSerializers(config)["publishBlindedBlock"],
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  return {
    getHeader: WithVersion((fork: ForkName) =>
      isForkExecution(fork) ? ssz.allForksExecution[fork].SignedBuilderBid : ssz.bellatrix.SignedBuilderBid
    ),
    submitBlindedBlock: WithVersion((fork: ForkName) =>
      isForkExecution(fork) ? ssz.allForksExecution[fork].ExecutionPayload : ssz.bellatrix.ExecutionPayload
    ),
    submitBlindedBlockV2: WithVersion((fork: ForkName) =>
      isForkBlobs(fork)
        ? ssz.allForksBlobs[fork].SignedBeaconBlockAndBlobsSidecar
        : ssz.deneb.SignedBeaconBlockAndBlobsSidecar
    ),
  };
}
