import {ReturnTypes, RoutesData, ReqSerializers, reqEmpty, ReqEmpty} from "../utils/index.js";
// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type Api = {
  checkStatus(): Promise<void>;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  checkStatus: {url: "/eth/v1/builder/status", method: "GET"},
};

/* eslint-disable @typescript-eslint/naming-convention */
export type ReqTypes = {
  checkStatus: ReqEmpty;
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  return {
    checkStatus: reqEmpty,
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  return {};
}
