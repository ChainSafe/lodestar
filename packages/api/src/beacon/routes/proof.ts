import {JsonPath} from "@chainsafe/ssz";
import {Proof} from "@chainsafe/persistent-merkle-tree";
import {ReturnTypes, RoutesData, Schema, sameType, ReqSerializers} from "../../utils/index.js";
import {queryParseProofPathsArr, querySerializeProofPathsArr} from "../../utils/serdes.js";
import {HttpStatusCode} from "../../utils/client/httpStatusCode.js";
import {ApiClientResponse} from "../../interfaces.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type Api = {
  /**
   * Returns a multiproof of `jsonPaths` at the requested `stateId`.
   * The requested `stateId` may not be available. Regular nodes only keep recent states in memory.
   */
  getStateProof(
    stateId: string,
    jsonPaths: JsonPath[]
  ): Promise<ApiClientResponse<{[HttpStatusCode.OK]: {data: Proof}}>>;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getStateProof: {url: "/eth/v0/beacon/proof/state/{state_id}", method: "GET"},
};

/* eslint-disable @typescript-eslint/naming-convention */
export type ReqTypes = {
  getStateProof: {params: {state_id: string}; query: {paths: string[]}};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  return {
    getStateProof: {
      writeReq: (state_id, paths) => ({params: {state_id}, query: {paths: querySerializeProofPathsArr(paths)}}),
      parseReq: ({params, query}) => [params.state_id, queryParseProofPathsArr(query.paths)],
      schema: {params: {state_id: Schema.StringRequired}, body: Schema.AnyArray},
    },
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  return {
    // Just sent the proof JSON as-is
    getStateProof: sameType(),
  };
}
