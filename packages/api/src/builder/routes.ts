import {ssz, bellatrix, Slot, Root, BLSPubkey} from "@lodestar/types";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
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

export type Api = {
  status(): Promise<void>;
  registerValidator(registrations: bellatrix.SignedValidatorRegistrationV1[]): Promise<void>;
  getHeader(
    slot: Slot,
    parentHash: Root,
    proposerPubKey: BLSPubkey
  ): Promise<{version: ForkName; data: bellatrix.SignedBuilderBid}>;
  submitBlindedBlock(
    signedBlock: bellatrix.SignedBlindedBeaconBlock
  ): Promise<{version: ForkName; data: bellatrix.ExecutionPayload}>;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  status: {url: "/eth/v1/builder/status", method: "GET"},
  registerValidator: {url: "/eth/v1/builder/validators", method: "POST"},
  getHeader: {url: "/eth/v1/builder/header/{slot}/{parent_hash}/{pubkey}", method: "GET"},
  submitBlindedBlock: {url: "/eth/v1/builder/blinded_blocks", method: "POST"},
};

/* eslint-disable @typescript-eslint/naming-convention */
export type ReqTypes = {
  status: ReqEmpty;
  registerValidator: {body: unknown};
  getHeader: {params: {slot: Slot; parent_hash: string; pubkey: string}};
  submitBlindedBlock: {body: unknown};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
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
    submitBlindedBlock: reqOnlyBody(ssz.bellatrix.SignedBlindedBeaconBlock, Schema.Object),
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  return {
    // TODO: Generalize to allForks
    getHeader: WithVersion(() => ssz.bellatrix.SignedBuilderBid),
    submitBlindedBlock: WithVersion(() => ssz.bellatrix.ExecutionPayload),
  };
}
