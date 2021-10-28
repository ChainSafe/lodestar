import {ContainerType, IJsonOptions, Json, ListType, Type} from "@chainsafe/ssz";
import {ForkName} from "@chainsafe/lodestar-params";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {objectToExpectedCase} from "@chainsafe/lodestar-utils";
import {Schema, SchemaDefinition} from "./schema";

// See /packages/api/src/routes/index.ts for reasoning

/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any */

/** All JSON must be sent in snake case */
export const jsonOpts = {case: "snake" as const};
/** All JSON inside the JS code must be camel case */
export const codeCase = "camel" as const;

export type RouteGroupDefinition<
  Api extends Record<string, RouteGeneric>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric}
> = {
  routesData: RoutesData<Api>;
  getReqSerializers: (config: IChainForkConfig) => ReqSerializers<Api, ReqTypes>;
  getReturnTypes: (config: IChainForkConfig) => ReturnTypes<Api>;
};

export type RouteDef = {
  url: string;
  method: "GET" | "POST";
};

export type ReqGeneric = {
  params?: Record<string, string | number>;
  query?: Record<string, string | number | (string | number)[]>;
  body?: any;
  headers?: Record<string, string[] | string | undefined>;
};

export type ReqEmpty = ReqGeneric;

export type RouteGeneric = (...args: any) => PromiseLike<any> | any;

type ThenArg<T> = T extends PromiseLike<infer U> ? U : T;
export type Resolves<T extends (...args: any) => any> = ThenArg<ReturnType<T>>;

export type TypeJson<T> = {
  toJson(val: T, opts?: IJsonOptions): Json;
  fromJson(json: Json, opts?: IJsonOptions): T;
};

//
// REQ
//

export type ReqSerializer<Fn extends (...args: any) => any, ReqType extends ReqGeneric> = {
  writeReq: (...args: Parameters<Fn>) => ReqType;
  parseReq: (arg: ReqType) => Parameters<Fn>;
  schema?: SchemaDefinition<ReqType>;
};

export type ReqSerializers<
  Api extends Record<string, RouteGeneric>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric}
> = {
  [K in keyof Api]: ReqSerializer<Api[K], ReqTypes[K]>;
};

/** Curried definition to infer only one of the two generic types */
export type ReqGenArg<Fn extends (...args: any) => any, ReqType extends ReqGeneric> = ReqSerializer<Fn, ReqType>;

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

//
// Helpers
//

/** Shortcut for routes that have no params, query nor body */
export const reqEmpty: ReqSerializer<() => void, ReqEmpty> = {
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

/** SSZ factory helper + typed. limit = 1e6 as a big enough random number */
export function ArrayOf<T>(elementType: Type<T>, limit = 1e6): ListType<T[]> {
  return new ListType({elementType, limit});
}

/**
 * SSZ factory helper + typed to return responses of type
 * ```
 * data: T
 * ```
 */
export function ContainerData<T>(dataType: Type<T>): ContainerType<{data: T}> {
  return new ContainerType({fields: {data: dataType}, expectedCase: "notransform"});
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
      data: getType(version || ForkName.phase0).toJson(data, opts),
      version,
    }),
    fromJson: ({data, version}: {data: Json; version: string}, opts) => {
      // Un-safe external data, validate version is known ForkName value
      if (!ForkName[version as ForkName]) throw Error(`Invalid version ${version}`);

      return {
        data: getType(version as ForkName).fromJson(data, opts),
        version: version as ForkName,
      };
    },
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
