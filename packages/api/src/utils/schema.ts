import {ReqGeneric} from "./types";

type JsonSchema = Record<string, any>;
type JsonSchemaObj = {
  type: "object";
  required: string[];
  properties: Record<string, JsonSchema>;
};

export type SchemaDefinition<ReqType extends ReqGeneric> = {
  params?: {
    [K in keyof ReqType["params"]]: Schema;
  };
  query?: {
    [K in keyof ReqType["query"]]: Schema;
  };
  body?: Schema;
};

export enum Schema {
  Uint,
  UintRequired,
  UintArray,
  String,
  StringRequired,
  StringArray,
  Object,
  ObjectArray,
}

function getJsonSchemaItem(schema: Schema): JsonSchema {
  switch (schema) {
    case Schema.Uint:
    case Schema.UintRequired:
      return {type: "number", minimum: 0};
    case Schema.UintArray:
      return {
        type: "array",
        items: {type: "number", minimum: 0},
      };

    case Schema.String:
    case Schema.StringRequired:
      return {type: "string"};
    case Schema.StringArray:
      return {
        type: "array",
        items: {type: "string"},
      };

    case Schema.Object:
      return {
        type: "object",
      };

    case Schema.ObjectArray:
      return {
        type: "array",
        items: {type: "object"},
      };
  }
}

function isRequired(schema: Schema): boolean {
  switch (schema) {
    case Schema.UintRequired:
    case Schema.StringRequired:
      return true;

    default:
      return false;
  }
}

export function getFastifySchema(schemaDef: SchemaDefinition<ReqGeneric>): JsonSchema {
  const schema: {params?: JsonSchemaObj; querystring?: JsonSchemaObj; body?: JsonSchema} = {};

  if (schemaDef.body) {
    schema.body = getJsonSchemaItem(schemaDef.body);
  }

  if (schemaDef.params) {
    schema.params = {type: "object", required: [] as string[], properties: {}};

    for (const [key, def] of Object.entries(schemaDef.params)) {
      schema.params.properties[key] = getJsonSchemaItem(def as Schema);
      if (isRequired(def as Schema)) {
        schema.params.required.push(key);
      }
    }
  }

  if (schemaDef.query) {
    schema.querystring = {type: "object", required: [] as string[], properties: {}};

    for (const [key, def] of Object.entries(schemaDef.query)) {
      schema.querystring.properties[key] = getJsonSchemaItem(def as Schema);
      if (isRequired(def as Schema)) {
        schema.querystring.required.push(key);
      }
    }
  }

  return schema;
}
