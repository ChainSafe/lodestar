import {MediaType} from "./headers.js";
import {Endpoint, HeaderParams, PathParams, QueryParams} from "./types.js";

// Reasoning: Allows to declare JSON schemas for server routes in a succinct typesafe way.
// The enums exposed here are very feature incomplete but cover the minimum necessary for
// the existing routes. Since the arguments for Ethereum Consensus server routes are very simple it suffice.

type JsonSchema = Record<string, unknown>;
type JsonSchemaObj = {
  type: "object";
  required: string[];
  properties: Record<string, JsonSchema>;
};
type RequireSchema<T> = {[K in keyof T]-?: Schema};

export type SchemaDefinition<ReqType extends Endpoint["request"]> = (ReqType["params"] extends PathParams
  ? {params: RequireSchema<ReqType["params"]>}
  : {params?: never}) &
  (ReqType["query"] extends QueryParams ? {query: RequireSchema<ReqType["query"]>} : {query?: never}) &
  (ReqType["headers"] extends HeaderParams ? {headers: RequireSchema<ReqType["headers"]>} : {headers?: never}) &
  (ReqType extends {body: unknown} ? {body: Schema} : {body?: never});

export enum Schema {
  Uint,
  UintRequired,
  UintArray,
  String,
  StringRequired,
  StringArray,
  StringArrayRequired,
  UintOrStringRequired,
  UintOrStringArray,
  Object,
  ObjectArray,
  AnyArray,
  Boolean,
}

/**
 * Return JSON schema from a Schema enum. Useful to declare schemas in a succinct format
 */
function getJsonSchemaItem(schema: Schema): JsonSchema {
  switch (schema) {
    case Schema.Uint:
    case Schema.UintRequired:
      return {type: "integer", minimum: 0};

    case Schema.UintArray:
      return {type: "array", items: {type: "integer", minimum: 0}};

    case Schema.String:
    case Schema.StringRequired:
      return {type: "string"};

    case Schema.StringArray:
    case Schema.StringArrayRequired:
      return {type: "array", items: {type: "string"}};

    case Schema.UintOrStringRequired:
      return {anyOf: [{type: "string"}, {type: "integer"}]};
    case Schema.UintOrStringArray:
      return {type: "array", items: {anyOf: [{type: "string"}, {type: "integer"}]}};

    case Schema.Object:
      return {type: "object"};

    case Schema.ObjectArray:
      return {type: "array", items: {type: "object"}};

    case Schema.AnyArray:
      return {type: "array"};

    case Schema.Boolean:
      return {type: "boolean"};
  }
}

function isRequired(schema: Schema): boolean {
  switch (schema) {
    case Schema.UintRequired:
    case Schema.StringRequired:
    case Schema.UintOrStringRequired:
    case Schema.StringArrayRequired:
      return true;

    default:
      return false;
  }
}

export function getFastifySchema<T extends Endpoint["request"]>(schemaDef: SchemaDefinition<T>): JsonSchema {
  const schema: {params?: JsonSchemaObj; querystring?: JsonSchemaObj; headers?: JsonSchemaObj; body?: JsonSchema} = {};

  if (schemaDef.body != null) {
    schema.body = {
      content: {
        [MediaType.json]: {
          schema: getJsonSchemaItem(schemaDef.body),
        },
        [MediaType.ssz]: {
          schema: {},
        },
      },
    };
  }

  if (schemaDef.params) {
    schema.params = {type: "object", required: [], properties: {}};

    for (const [key, def] of Object.entries<Schema>(schemaDef.params)) {
      schema.params.properties[key] = getJsonSchemaItem(def);
      if (isRequired(def)) {
        schema.params.required.push(key);
      }
    }
  }

  if (schemaDef.query) {
    schema.querystring = {type: "object", required: [], properties: {}};

    for (const [key, def] of Object.entries<Schema>(schemaDef.query)) {
      schema.querystring.properties[key] = getJsonSchemaItem(def);
      if (isRequired(def)) {
        schema.querystring.required.push(key);
      }
    }
  }

  if (schemaDef.headers) {
    schema.headers = {type: "object", required: [], properties: {}};

    for (const [key, def] of Object.entries<Schema>(schemaDef.headers)) {
      schema.headers.properties[key] = getJsonSchemaItem(def);
      if (isRequired(def)) {
        schema.headers.required.push(key);
      }
    }
  }

  return schema;
}
