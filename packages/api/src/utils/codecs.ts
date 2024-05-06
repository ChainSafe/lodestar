/* eslint-disable @typescript-eslint/naming-convention */
import {ArrayType, ListBasicType, ListCompositeType, Type, isBasicType, isCompositeType} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {objectToExpectedCase} from "@lodestar/utils";
import {
  RequestWithoutBodyCodec,
  RequestWithBodyCodec,
  ResponseCodec,
  ResponseDataCodec,
  ResponseMetadataCodec,
  Endpoint,
  SszRequestMethods,
  JsonRequestMethods,
} from "./types.js";
import {toForkName} from "./serdes.js";
import {WireFormat} from "./wireFormat.js";

// Utility types / codecs

export type EmptyArgs = void;
export type EmptyRequest = Record<never, never>;
export type EmptyResponseData = void;
export type EmptyMeta = void;

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export type AnyEndpoint = Endpoint<any, any, any, any, any>;
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export type EmptyRequestEndpoint = Endpoint<any, EmptyArgs, EmptyRequest, any, any>;
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export type EmptyResponseEndpoint = Endpoint<any, any, any, EmptyResponseData, EmptyMeta>;

/** Shortcut for routes that have no params, query */
export const EmptyRequestCodec: RequestWithoutBodyCodec<EmptyRequestEndpoint> = {
  writeReq: () => ({}),
  parseReq: () => {},
  schema: {},
};

export function JsonOnlyReq<E extends Endpoint>(
  req: Omit<RequestWithBodyCodec<E>, keyof SszRequestMethods<E>>
): RequestWithBodyCodec<E> {
  return {
    ...req,
    writeReqSsz: () => {
      throw Error("Not implemented");
    },
    parseReqSsz: () => {
      throw Error("Not implemented");
    },
    onlySupport: WireFormat.json,
  };
}

export function SszOnlyReq<E extends Endpoint>(
  req: Omit<RequestWithBodyCodec<E>, keyof JsonRequestMethods<E>>
): RequestWithBodyCodec<E> {
  return {
    ...req,
    writeReqJson: () => {
      throw Error("Not implemented");
    },
    parseReqJson: () => {
      throw Error("Not implemented");
    },
    onlySupport: WireFormat.ssz,
  };
}

export const EmptyResponseDataCodec: ResponseDataCodec<EmptyResponseData, EmptyMeta> = {
  toJson: () => {},
  fromJson: () => {},
  serialize: () => new Uint8Array(),
  deserialize: () => {},
};

export const EmptyMetaCodec: ResponseMetadataCodec<EmptyMeta> = {
  toJson: () => {},
  fromJson: () => {},
  toHeadersObject: () => ({}),
  fromHeaders: () => {},
};

export const EmptyResponseCodec: ResponseCodec<EmptyResponseEndpoint> = {
  data: EmptyResponseDataCodec,
  meta: EmptyMetaCodec,
  isEmpty: true,
};

export function ArrayOf<T>(elementType: Type<T>, limit = Infinity): ArrayType<Type<T>, unknown, unknown> {
  if (isCompositeType(elementType)) {
    return new ListCompositeType(elementType, limit) as unknown as ArrayType<Type<T>, unknown, unknown>;
  } else if (isBasicType(elementType)) {
    return new ListBasicType(elementType, limit) as unknown as ArrayType<Type<T>, unknown, unknown>;
  } else {
    throw Error(`Unknown type ${elementType.typeName}`);
  }
}

export function WithMeta<T, M extends {version: ForkName}>(getType: (m: M) => Type<T>): ResponseDataCodec<T, M> {
  return {
    toJson: (data, meta: M) => getType(meta).toJson(data),
    fromJson: (data, meta: M) => getType({...meta, version: toForkName(meta.version)}).fromJson(data),
    serialize: (data, meta: M) => getType(meta).serialize(data),
    deserialize: (data, meta: M) => getType({...meta, version: toForkName(meta.version)}).deserialize(data),
  };
}

export function WithVersion<T, M extends {version: ForkName}>(
  getType: (v: ForkName) => Type<T>
): ResponseDataCodec<T, M> {
  return {
    toJson: (data, meta: M) => getType(meta.version).toJson(data),
    fromJson: (data, meta: M) => getType(toForkName(meta.version)).fromJson(data),
    serialize: (data, meta: M) => getType(meta.version).serialize(data),
    deserialize: (data, meta: M) => getType(toForkName(meta.version)).deserialize(data),
  };
}

// TODO: check on unstable, refactor? We should probably drop this and add ssz types for everything, to get some field level validation
export const JsonOnlyResponseCodec: ResponseCodec<AnyEndpoint> = {
  data: {
    toJson: (d) => objectToExpectedCase(d as Record<string, unknown>, "snake"),
    fromJson: (d) => objectToExpectedCase(d as Record<string, unknown>, "camel"),
    serialize: () => {
      throw Error("Not implemented");
    },
    deserialize: () => {
      throw Error("Not implemented");
    },
  },
  meta: EmptyMetaCodec,
  onlySupport: WireFormat.json,
};
