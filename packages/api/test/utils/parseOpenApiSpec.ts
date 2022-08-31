export type OpenApiFile = {
  url: string;
  filepath: string;
  version: RegExp;
};

/** "getBlockRoot" */
type OperationId = string;
/** "/eth/v1/beacon/blocks/{block_id}/root" */
type RouteUrl = string;
/** "get" | "post" */
type HttpMethod = string;

type JsonSchema = {
  type: "object";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  nullable?: boolean;
  description?: string;
  enum?: string[];
};

export type OpenApiJson = {
  paths: Record<RouteUrl, Record<HttpMethod, RouteDefinition>>;
  info: {
    version: string;
  };
};

type Content = {
  /** `"application/json"` */
  [contentType: string]: {
    schema: JsonSchema;
    examples?: {
      [exampleName: string]: {
        description: string;
        value: string;
      };
    };
  };
};

type RouteDefinition = {
  /** "getBlockRoot" */
  operationId: string;
  parameters: {
    name: string;
    in: "path" | "query";
    schema: JsonSchema;
  }[];
  responses: {
    /** `"200"` | `"500"` */
    [statusCode: string]: {
      content?: Content;
    };
  };
  requestBody?: {
    content?: Content;
  };
};

export type RouteSpec = {
  url: RouteUrl;
  method: HttpMethod;
  responseOkSchema: JsonSchema | undefined;
  requestSchema: JsonSchema;
};

export type ReqSchema = {
  params?: JsonSchema;
  query?: JsonSchema;
  body?: JsonSchema;
};

enum StatusCode {
  ok = "200",
}

enum ContentType {
  json = "application/json",
}

export type ParseOpenApiSpecOpts = {
  routesDropOneOf?: string[];
};

export function parseOpenApiSpec(openApiJson: OpenApiJson, opts?: ParseOpenApiSpecOpts): Map<OperationId, RouteSpec> {
  const routes = new Map<OperationId, RouteSpec>();

  for (const [routeUrl, routesByMethod] of Object.entries(openApiJson.paths)) {
    for (const [httpMethod, routeDefinition] of Object.entries(routesByMethod)) {
      const responseOkSchema = routeDefinition.responses[StatusCode.ok]?.content?.[ContentType.json]?.schema;

      const dropOneOf = opts?.routesDropOneOf?.includes(routeDefinition.operationId);

      // Force all properties to have required, else ajv won't validate missing properties
      if (responseOkSchema) {
        try {
          preprocessSchema(responseOkSchema, {dropOneOf});
        } catch (e) {
          // eslint-disable-next-line no-console
          console.log(responseOkSchema);
          throw e;
        }
      }

      const requestSchema = buildReqSchema(routeDefinition);
      preprocessSchema(requestSchema, {dropOneOf});

      routes.set(routeDefinition.operationId, {
        url: routeUrl,
        method: httpMethod,
        responseOkSchema,
        requestSchema,
      });
    }
  }

  return routes;
}

function preprocessSchema(schema: JsonSchema, opts?: {dropOneOf?: boolean}): void {
  // Require all properties
  applyRecursively(schema, (obj) => {
    if (obj.type === "object" && obj.properties && !obj.required) {
      obj.required = Object.keys(obj.properties);
    }
  });

  // Remove nullable
  applyRecursively(schema, (obj) => {
    delete obj.nullable;
  });

  // Remove required: false
  applyRecursively(schema, (obj) => {
    if (typeof obj.required === "boolean") {
      delete obj.required;
    }
  });

  if (opts?.dropOneOf) {
    // Pick single oneOf, AJV has trouble validating against blocks and states
    applyRecursively(schema, (obj) => {
      if (obj.oneOf) {
        // splice(1) = mutate array in place to drop all items after index 1 (included)
        obj.oneOf.splice(1);
      }
    });
  }

  // Remove non-intersecting allOf enum
  applyRecursively(schema, (obj) => {
    if (obj.allOf && obj.allOf.every((s) => s.enum)) {
      obj.allOf = [obj.allOf[0]];
    }
  });
}

export function applyRecursively(schema: unknown, fn: (obj: JsonSchema) => void): void {
  if (Array.isArray(schema)) {
    for (const item of schema) {
      applyRecursively(item, fn);
    }
  } else if (typeof schema === "object" && schema !== null) {
    for (const key of Object.keys(schema)) {
      applyRecursively((schema as Record<string, string>)[key], fn);
    }

    fn(schema as JsonSchema);
  }
}

function buildReqSchema(routeDefinition: RouteDefinition): JsonSchema {
  const reqSchemas: ReqSchema = {};

  // "parameters": [{
  //     "name": "block_id",
  //     "in": "path",
  //     "required": true,
  //     "example": "head",
  //     "schema": {
  //       "type": "string"
  //     },
  // }],

  // "parameters": [{
  //     "name": "slot",
  //     "in": "query",
  //     "required": false,
  //     "schema": {
  //       "type": "string",
  //     }
  // }],

  for (const parameter of routeDefinition.parameters ?? []) {
    switch (parameter.in) {
      case "path":
        if (!reqSchemas.params) reqSchemas.params = {type: "object", properties: {}};
        if (!reqSchemas.params.properties) reqSchemas.params.properties = {};
        reqSchemas.params.properties[parameter.name] = parameter.schema;
        break;

      case "query":
        if (!reqSchemas.query) reqSchemas.query = {type: "object", properties: {}};
        if (!reqSchemas.query.properties) reqSchemas.query.properties = {};
        reqSchemas.query.properties[parameter.name] = parameter.schema;
        break;

      // case "header"
    }
  }

  const requestJsonSchema = routeDefinition.requestBody?.content?.[ContentType.json].schema;

  if (requestJsonSchema) {
    reqSchemas.body = requestJsonSchema;
  }

  return {
    type: "object",
    properties: reqSchemas as Record<string, JsonSchema>,
  };
}

// All routes implemented
// - Correct URL
// - Correct method
// - Correct query?
// - Correct body?
// - Correct return type
