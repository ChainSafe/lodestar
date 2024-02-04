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

export type SchemaDefinition<ReqType extends Endpoint["request"]> = {
  params: ReqType["params"] extends PathParams
    ? {
        [K in keyof ReqType["params"]]: Schema;
      }
    : never;
  query: ReqType["query"] extends QueryParams
    ? {
        [K in keyof ReqType["query"]]: Schema;
      }
    : never;
  headers: ReqType["headers"] extends HeaderParams
    ? {
        [K in keyof ReqType["headers"]]: Schema;
      }
    : never;
  body: ReqType["body"] extends undefined ? never : Schema;
};

export enum Schema {
  Uint,
  UintRequired,
  UintArray,
  String,
  StringRequired,
  StringArray,
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
      return true;

    default:
      return false;
  }
}

export function getFastifySchema(schemaDef: SchemaDefinition<Endpoint["request"]>): JsonSchema {
  const schema: {params?: JsonSchemaObj; querystring?: JsonSchemaObj; headers?: JsonSchemaObj; body?: JsonSchema} = {};

  if (schemaDef.body != null) {
    schema.body = getJsonSchemaItem(schemaDef.body);
  }

  if (schemaDef.params) {
    schema.params = {type: "object", required: [] as string[], properties: {}};

    for (const [key, def] of Object.entries<Schema>(schemaDef.params)) {
      schema.params.properties[key] = getJsonSchemaItem(def);
      if (isRequired(def)) {
        schema.params.required.push(key);
      }
    }
  }

  if (schemaDef.query) {
    schema.querystring = {type: "object", required: [] as string[], properties: {}};

    for (const [key, def] of Object.entries<Schema>(schemaDef.query)) {
      schema.querystring.properties[key] = getJsonSchemaItem(def);
      if (isRequired(def)) {
        schema.querystring.required.push(key);
      }
    }
  }

  if (schemaDef.headers) {
    schema.headers = {type: "object", required: [] as string[], properties: {}};

    for (const [key, def] of Object.entries<Schema>(schemaDef.headers)) {
      schema.headers.properties[key] = getJsonSchemaItem(def);
      if (isRequired(def)) {
        schema.headers.required.push(key);
      }
    }
  }

  return schema;
}
