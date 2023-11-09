import {isBasicType, ListBasicType, Type, isCompositeType, ListCompositeType, ArrayType} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {ChainForkConfig} from "@lodestar/config";
import {objectToExpectedCase} from "@lodestar/utils";
import {APIClientHandler, ApiClientResponseData, APIServerHandler, ClientApi} from "../interfaces.js";
import {Schema, SchemaDefinition} from "./schema.js";

// See /packages/api/src/routes/index.ts for reasoning

/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any */

/** All JSON inside the JS code must be camel case */
const codeCase = "camel" as const;

export type RouteGroupDefinition<
  Api extends Record<string, APIServerHandler>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric},
> = {
  routesData: RoutesData<Api>;
  getReqSerializers: (config: ChainForkConfig) => ReqSerializers<Api, ReqTypes>;
  getReturnTypes: (config: ChainForkConfig) => ReturnTypes<ClientApi<Api>>;
};

export type RouteDef = {
  url: string;
  method: "GET" | "POST" | "DELETE";
  statusOk?: number;
};

export type ReqGeneric = {
  params?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | (string | number)[]>;
  body?: any;
  headers?: Record<string, string[] | string | undefined>;
};

export type ReqEmpty = ReqGeneric;
export type Resolves<T extends (...args: any) => any> = Awaited<ReturnType<T>>;

export type TypeJson<T> = {
  toJson(val: T): unknown;
  fromJson(json: unknown): T;
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
  Api extends Record<string, APIServerHandler>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric},
> = {
  [K in keyof Api]: ReqSerializer<Api[K], ReqTypes[K]>;
};

/** Curried definition to infer only one of the two generic types */
export type ReqGenArg<Fn extends (...args: any) => any, ReqType extends ReqGeneric> = ReqSerializer<Fn, ReqType>;

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
): ReqGenArg<(arg: T) => Promise<void>, {body: unknown}> => ({
  writeReq: (items) => ({body: type.toJson(items)}),
  parseReq: ({body}) => [type.fromJson(body)],
  schema: {body: bodySchema},
});

/** SSZ factory helper + typed. limit = 1e6 as a big enough random number */
export function ArrayOf<T>(elementType: Type<T>): ArrayType<Type<T>, unknown, unknown> {
  if (isCompositeType(elementType)) {
    return new ListCompositeType(elementType, Infinity) as unknown as ArrayType<Type<T>, unknown, unknown>;
  } else if (isBasicType(elementType)) {
    return new ListBasicType(elementType, Infinity) as unknown as ArrayType<Type<T>, unknown, unknown>;
  } else {
    throw Error(`Unknown type ${elementType.typeName}`);
  }
}

/**
 * SSZ factory helper + typed to return responses of type
 * ```
 * data: T
 * ```
 */
export function ContainerData<T>(dataType: TypeJson<T>): TypeJson<{data: T}> {
  return {
    toJson: ({data}) => ({
      data: dataType.toJson(data),
    }),
    fromJson: ({data}: {data: unknown}) => {
      return {
        data: dataType.fromJson(data),
      };
    },
  };
}

/**
 * SSZ factory helper + typed to return responses of type `{data: T; executionOptimistic: boolean}`
 */
export function ContainerDataExecutionOptimistic<T>(
  dataType: TypeJson<T>
): TypeJson<{data: T; executionOptimistic: boolean}> {
  return {
    toJson: ({data, executionOptimistic}) => ({
      data: dataType.toJson(data),
      execution_optimistic: executionOptimistic,
    }),
    fromJson: ({data, execution_optimistic}: {data: unknown; execution_optimistic: boolean}) => {
      return {
        data: dataType.fromJson(data),
        executionOptimistic: execution_optimistic,
      };
    },
  };
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
    toJson: ({data, version}) => ({
      data: getType(version ?? ForkName.phase0).toJson(data),
      version,
    }),
    fromJson: ({data, version}: {data: unknown; version: string}) => {
      // Teku returns fork as UPPERCASE
      version = version.toLowerCase();

      // Un-safe external data, validate version is known ForkName value
      if (!(version in ForkName)) throw Error(`Invalid version ${version}`);

      return {
        data: getType(version as ForkName).fromJson(data),
        version: version as ForkName,
      };
    },
  };
}

/**
 * SSZ factory helper to wrap an existing type with `{executionOptimistic: boolean}`
 */
export function WithExecutionOptimistic<T extends {data: unknown}>(
  type: TypeJson<T>
): TypeJson<T & {executionOptimistic: boolean}> {
  return {
    toJson: ({executionOptimistic, ...data}) => ({
      ...(type.toJson(data as unknown as T) as Record<string, unknown>),
      execution_optimistic: executionOptimistic,
    }),
    fromJson: ({execution_optimistic, ...data}: T & {execution_optimistic: boolean}) => ({
      ...type.fromJson(data),
      executionOptimistic: execution_optimistic,
    }),
  };
}

/**
 * SSZ factory helper to wrap an existing type with `{executionPayloadValue: Wei}`
 */
export function WithExecutionPayloadValue<T extends {data: unknown}>(
  type: TypeJson<T>
): TypeJson<T & {executionPayloadValue: bigint}> {
  return {
    toJson: ({executionPayloadValue, ...data}) => ({
      ...(type.toJson(data as unknown as T) as Record<string, unknown>),
      execution_payload_value: executionPayloadValue.toString(),
    }),
    fromJson: ({execution_payload_value, ...data}: T & {execution_payload_value: string}) => ({
      ...type.fromJson(data),
      // For cross client usage where beacon or validator are of separate clients, executionPayloadValue could be missing
      executionPayloadValue: BigInt(execution_payload_value ?? "0"),
    }),
  };
}

type JsonCase = "snake" | "constant" | "camel" | "param" | "header" | "pascal" | "dot" | "notransform";

/** Helper to only translate casing */
export function jsonType<T extends Record<string, unknown> | Record<string, unknown>[] | unknown[]>(
  jsonCase: JsonCase
): TypeJson<T> {
  return {
    toJson: (val: T) => objectToExpectedCase(val as Record<string, unknown>, jsonCase),
    fromJson: (json) => objectToExpectedCase(json as Record<string, unknown>, codeCase) as T,
  };
}

/** Helper to not do any transformation with the type */
export function sameType<T>(): TypeJson<T> {
  return {
    toJson: (val) => val as unknown,
    fromJson: (json) => json as T,
  };
}

//
// RETURN
//
export type KeysOfNonVoidResolveValues<Api extends Record<string, APIClientHandler>> = {
  [K in keyof Api]: ApiClientResponseData<Resolves<Api[K]>> extends void ? never : K;
}[keyof Api];

export type ReturnTypes<Api extends Record<string, APIClientHandler>> = {
  [K in keyof Pick<Api, KeysOfNonVoidResolveValues<Api>>]: TypeJson<ApiClientResponseData<Resolves<Api[K]>>>;
};

export type RoutesData<Api extends Record<string, APIServerHandler>> = {[K in keyof Api]: RouteDef};
