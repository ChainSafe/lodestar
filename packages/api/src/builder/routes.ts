import {ssz, bellatrix, Slot, Root, BLSPubkey} from "@lodestar/types";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {
  ReturnTypes,
  RoutesData,
  Schema,
  ReqSerializers,
  reqOnlyBody,
  ContainerData,
  reqEmpty,
  ReqEmpty,
  ArrayOf,
} from "../utils/index.js";
// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type Api = {
  checkStatus(): Promise<void>;
  registerValidator(registrations: bellatrix.SignedValidatorRegistrationV1[]): Promise<void>;
  getPayloadHeader(
    slot: Slot,
    parentHash: Root,
    proposerPubKey: BLSPubkey
  ): Promise<{data: bellatrix.SignedBuilderBid}>;
  submitSignedBlindedBlock(
    signedBlock: bellatrix.SignedBlindedBeaconBlock
  ): Promise<{data: bellatrix.ExecutionPayload}>;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  checkStatus: {url: "/eth/v1/builder/status", method: "GET"},
  registerValidator: {url: "/eth/v1/builder/validators", method: "POST"},
  getPayloadHeader: {url: "/eth/v1/builder/header/:slot/:parent_hash/:pubkey", method: "GET"},
  submitSignedBlindedBlock: {url: "/eth/v1/builder/blinded_blocks", method: "POST"},
};

/* eslint-disable @typescript-eslint/naming-convention */
export type ReqTypes = {
  checkStatus: ReqEmpty;
  registerValidator: {body: unknown};
  getPayloadHeader: {params: {slot: Slot; parent_hash: string; pubkey: string}};
  submitSignedBlindedBlock: {body: unknown};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  return {
    checkStatus: reqEmpty,
    registerValidator: reqOnlyBody(ArrayOf(ssz.bellatrix.SignedValidatorRegistrationV1), Schema.ObjectArray),
    getPayloadHeader: {
      writeReq: (slot, parentHash, proposerPubKey) => ({
        params: {slot, parent_hash: toHexString(parentHash), pubkey: toHexString(proposerPubKey)},
      }),
      parseReq: ({params}) => [params.slot, fromHexString(params.parent_hash), fromHexString(params.pubkey)],
      schema: {
        params: {slot: Schema.UintRequired, parent_hash: Schema.StringRequired, pubkey: Schema.StringRequired},
      },
    },
    submitSignedBlindedBlock: reqOnlyBody(ssz.bellatrix.SignedBlindedBeaconBlock, Schema.Object),
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  return {
    getPayloadHeader: ContainerData(ssz.bellatrix.SignedBuilderBid),
    submitSignedBlindedBlock: ContainerData(ssz.bellatrix.ExecutionPayload),
  };
}
