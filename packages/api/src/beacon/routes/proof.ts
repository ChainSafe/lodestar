import {Proof} from "@chainsafe/persistent-merkle-tree";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {ReturnTypes, RoutesData, Schema, sameType, ReqSerializers} from "../../utils/index.js";
import {HttpStatusCode} from "../../utils/client/httpStatusCode.js";
import {ApiClientResponse} from "../../interfaces.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type Api = {
  /**
   * Returns a multiproof of `descriptor` at the requested `stateId`.
   * The requested `stateId` may not be available. Regular nodes only keep recent states in memory.
   */
  getStateProof(
    stateId: string,
    descriptor: Uint8Array
  ): Promise<ApiClientResponse<{[HttpStatusCode.OK]: {data: Proof}}>>;
  /**
   * Returns a multiproof of `descriptor` at the requested `blockId`.
   * The requested `blockId` may not be available. Regular nodes only keep recent states in memory.
   */
  getBlockProof(
    blockId: string,
    descriptor: Uint8Array
  ): Promise<ApiClientResponse<{[HttpStatusCode.OK]: {data: Proof}}>>;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getStateProof: {url: "/eth/v0/beacon/proof/state/{state_id}", method: "GET"},
  getBlockProof: {url: "/eth/v0/beacon/proof/block/{block_id}", method: "GET"},
};

/* eslint-disable @typescript-eslint/naming-convention */
export type ReqTypes = {
  getStateProof: {params: {state_id: string}; query: {format: string}};
  getBlockProof: {params: {block_id: string}; query: {format: string}};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  return {
    getStateProof: {
      writeReq: (state_id, descriptor) => ({params: {state_id}, query: {format: toHexString(descriptor)}}),
      parseReq: ({params, query}) => [params.state_id, fromHexString(query.format)],
      schema: {params: {state_id: Schema.StringRequired}, query: {format: Schema.StringRequired}},
    },
    getBlockProof: {
      writeReq: (block_id, descriptor) => ({params: {block_id}, query: {format: toHexString(descriptor)}}),
      parseReq: ({params, query}) => [params.block_id, fromHexString(query.format)],
      schema: {params: {block_id: Schema.StringRequired}, query: {format: Schema.StringRequired}},
    },
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  return {
    // Just sent the proof JSON as-is
    getStateProof: sameType(),
    getBlockProof: sameType(),
  };
}
