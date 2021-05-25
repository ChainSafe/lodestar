import {ContainerType, IJsonOptions, Json, ListType, Type} from "@chainsafe/ssz";
import {ForkName, IBeaconConfig} from "@chainsafe/lodestar-config";
import {objectToExpectedCase} from "@chainsafe/lodestar-utils";
import {Schema, SchemaDefinition} from "./schema";

// Reasoning of the API definitions

// api args => req params
// --- wire
// req params => api args
// --- exec api
// api return => res body
// --- wire
// res body => api return

// Server has to know:
// - req params => api args
// - api return => res body

// Client has to know:
// - api args => req params
// - res body => api return

// Extra things to consider
// - The debug state route returns a bytes stream
// - The events routes return Server Events not a JSON HTTP response
// - There are v1 and v2 routes that should be merge in one handler

// For a returned JSON value, we don't really need the SSZ type
// - need to convert camelCase to snake_case when sending
// - need to convert from snake_case to camelCase when receiving
// - need to convert BigInt, 0x01 to bytes, etc.
// ?? - Define a return SSZ type for the routes that need it?

/** All JSON must be sent in snake case */
export const jsonOpts = {case: "snake" as const};
/** All JSON inside the JS code must be camel case */
export const codeCase = "camel" as const;

export type RouteGroupDefinition<
  Api extends Record<string, RouteGeneric>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric}
> = {
  routesData: RoutesData<Api>;
  getReqSerdes: (config: IBeaconConfig) => RouteReqSerdes<Api, ReqTypes>;
  getReturnTypes: (config: IBeaconConfig) => ReturnTypes<Api>;
};

/* eslint-disable @typescript-eslint/naming-convention */

export type RouteDef = {
  url: string;
  method: "GET" | "POST";
};

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ReqGeneric = {
  params?: Record<string, string | number>;
  query?: Record<string, string | number | (string | number)[]>;
  body?: any;
};

export type ReqEmpty = ReqGeneric;

export type RouteGeneric = (...args: any) => Promise<any>;

type ThenArg<T> = T extends PromiseLike<infer U> ? U : T;
export type Resolves<T extends (...args: any) => any> = ThenArg<ReturnType<T>>;

export type TypeJson<T> = {
  toJson(val: T, opts?: IJsonOptions): Json;
  fromJson(json: Json, opts?: IJsonOptions): T;
};

//
// REQ
//

export type ReqDef<Fn extends (...args: any) => any, ReqType extends ReqGeneric> = {
  writeReq: (...args: Parameters<Fn>) => ReqType;
  parseReq: (arg: ReqType) => Parameters<Fn>;
  schema?: SchemaDefinition<ReqType>;
};

export type RouteReqSerdes<
  Api extends Record<string, RouteGeneric>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric}
> = {
  [K in keyof Api]: ReqDef<Api[K], ReqTypes[K]>;
};

/** Curried definition to infer only one of the two generic types */
export type ReqGenArg<Fn extends (...args: any) => any, ReqType extends ReqGeneric> = ReqDef<Fn, ReqType>;

export type RouteReqTypeGenerator<Api extends Record<string, RouteGeneric>> = {
  [K in keyof Api]: <ReqType extends ReqGeneric>(arg: ReqGenArg<Api[K], ReqType>) => ReqGenArg<Api[K], ReqType>;
};

//
// RETURN
//

export type KeysOfNonVoidResolveValues<Api extends Record<string, RouteGeneric>> = {
  [K in keyof Api]: Resolves<Api[K]> extends void ? never : K;
}[keyof Api];

export type ReturnTypes<Api extends Record<string, RouteGeneric>> = {
  [K in keyof Pick<Api, KeysOfNonVoidResolveValues<Api>>]: TypeJson<Resolves<Api[K]>>;
};

export type RoutesData<Api extends Record<string, RouteGeneric>> = {[K in keyof Api]: RouteDef};

export type GetRouteReqSerdes<
  Api extends Record<string, RouteGeneric>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric}
> = (config: IBeaconConfig) => RouteReqSerdes<Api, ReqTypes>;

//
// Helpers
//

/** Shortcut for routes that have no params, query nor body */
export const reqEmpty: ReqDef<() => void, ReqEmpty> = {
  writeReq: () => ({}),
  parseReq: () => [] as [],
};

/** Shortcut for routes that have only body */
export const reqOnlyBody = <T>(
  type: TypeJson<T>,
  bodySchema: Schema
): ReqGenArg<(arg: T) => Promise<void>, {body: Json}> => ({
  writeReq: (items) => ({body: type.toJson(items, jsonOpts)}),
  parseReq: ({body}) => [type.fromJson(body, jsonOpts)],
  schema: {body: bodySchema},
});

/** SSZ factory helper + typed */
export function ArrayOf<T>(elementType: Type<T>): ListType<T[]> {
  return new ListType({elementType, limit: 1});
}

/**
 * SSZ factory helper + typed to return responses of type
 * ```
 * data: T
 * ```
 */
export function ContainerData<T>(dataType: Type<T>): ContainerType<{data: T}> {
  return new ContainerType({fields: {data: dataType}});
}

/**
 * SSZ factory helper + typed to return responses of type
 * ```
 * data: T
 * version: ForkName
 * ```
 */
export function WithVersion<T>(getType: (fork: ForkName) => TypeJson<T>): TypeJson<{data: T; version: ForkName}> {
  return {
    toJson: ({data, version}, opts) => ({
      data: getType(version).toJson(data, opts),
      version,
    }),
    fromJson: ({data, version}: {data: Json; version: string}, opts) => ({
      data: getType(version as ForkName).fromJson(data, opts),
      version: version as ForkName,
    }),
  };
}

/** Helper to only translate casing */
export function jsonType<T extends Record<string, unknown> | Record<string, unknown>[]>(): TypeJson<T> {
  return {
    toJson: (val, opts) => objectToExpectedCase(val, opts?.case) as Json,
    fromJson: (json) => objectToExpectedCase(json as Record<string, unknown>, codeCase) as T,
  };
}

/** Helper to not do any transformation with the type */
export function sameType<T>(): TypeJson<T> {
  return {
    toJson: (val) => (val as unknown) as Json,
    fromJson: (json) => (json as unknown) as T,
  };
}
