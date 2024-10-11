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

export type JsonSchema = {
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
    in: "path" | "query" | "header";
    schema: JsonSchema;
  }[];
  responses: {
    /** `"200"` | `"500"` */
    [statusCode: string]:
      | {
          headers?: Record<string, {schema: JsonSchema}>;
          content?: Content;
        }
      | undefined;
  };
  requestBody?: {
    content?: Content;
  };
};

export type RouteSpec = {
  url: RouteUrl;
  method: HttpMethod;
  responseOkSchema: JsonSchema | undefined;
  responseSszRequired: boolean;
  requestSchema: JsonSchema;
  requestSszRequired: boolean;
};

export type ReqSchema = {
  params?: JsonSchema;
  query?: JsonSchema;
  headers?: JsonSchema;
  body?: JsonSchema;
};

export type RespSchema = {
  headers?: JsonSchema;
  body?: JsonSchema;
};

enum StatusCode {
  ok = "200",
}

enum ContentType {
  json = "application/json",
  ssz = "application/octet-stream",
}

export function parseOpenApiSpec(openApiJson: OpenApiJson): Map<OperationId, RouteSpec> {
  const routes = new Map<OperationId, RouteSpec>();

  for (const [routeUrl, routesByMethod] of Object.entries(openApiJson.paths)) {
    for (const [httpMethod, routeDefinition] of Object.entries(routesByMethod)) {
      const responseOkSchema = buildRespSchema(routeDefinition);

      // Force all properties to have required, else ajv won't validate missing properties
      try {
        preprocessSchema(responseOkSchema);
      } catch (e) {
        console.log(responseOkSchema);
        throw e;
      }
      const responseSszRequired =
        routeDefinition.responses[StatusCode.ok]?.content?.[ContentType.ssz]?.schema !== undefined;

      const requestSchema = buildReqSchema(routeDefinition);
      preprocessSchema(requestSchema);
      const requestSszRequired = routeDefinition.requestBody?.content?.[ContentType.ssz]?.schema !== undefined;

      routes.set(routeDefinition.operationId, {
        url: routeUrl,
        method: httpMethod,
        responseOkSchema,
        responseSszRequired,
        requestSchema,
        requestSszRequired,
      });
    }
  }

  return routes;
}

function preprocessSchema(schema: JsonSchema): void {
  // Require all properties
  applyRecursively(schema, (obj) => {
    if (obj.type === "object" && obj.properties && !obj.required) {
      obj.required = Object.keys(obj.properties);
    }
  });

  // Remove nullable
  applyRecursively(schema, (obj) => {
    obj.nullable = undefined;
  });

  // Remove required: false
  applyRecursively(schema, (obj) => {
    if (typeof obj.required === "boolean") {
      obj.required = undefined;
    }
  });

  // Remove non-intersecting allOf enum
  applyRecursively(schema, (obj) => {
    if (obj.allOf?.every((s) => s.enum)) {
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
  const reqSchema: ReqSchema = {};

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
        if (!reqSchema.params) reqSchema.params = {type: "object", properties: {}};
        if (!reqSchema.params.properties) reqSchema.params.properties = {};
        reqSchema.params.properties[parameter.name] = parameter.schema;
        break;

      case "query":
        if (!reqSchema.query) reqSchema.query = {type: "object", properties: {}};
        if (!reqSchema.query.properties) reqSchema.query.properties = {};
        reqSchema.query.properties[parameter.name] = parameter.schema;
        break;

      case "header":
        if (!reqSchema.headers) reqSchema.headers = {type: "object", properties: {}};
        if (!reqSchema.headers.properties) reqSchema.headers.properties = {};
        reqSchema.headers.properties[parameter.name] = parameter.schema;
        break;
    }
  }

  const requestJsonSchema = routeDefinition.requestBody?.content?.[ContentType.json]?.schema;

  if (requestJsonSchema) {
    reqSchema.body = requestJsonSchema;
  }

  return {
    type: "object",
    properties: reqSchema,
  };
}

function buildRespSchema(routeDefinition: RouteDefinition): JsonSchema {
  const respSchema: RespSchema = {};

  const responseOk = routeDefinition.responses[StatusCode.ok];

  // "headers": {
  //   "Eth-Consensus-Version": {
  //     "required": true,
  //     "schema": {
  //       "type": "string",
  //       "enum": ["phase0", "altair", "bellatrix", "capella", "deneb"],
  //       "example": "phase0",
  //     },
  //   },
  // },

  if (responseOk?.headers) {
    Object.entries(responseOk.headers).map(([header, {schema}]) => {
      if (!respSchema.headers) respSchema.headers = {type: "object", properties: {}};
      if (!respSchema.headers.properties) respSchema.headers.properties = {};
      respSchema.headers.properties[header] = schema;
    });
  }

  const responseJsonSchema = responseOk?.content?.[ContentType.json]?.schema;
  if (responseJsonSchema) {
    respSchema.body = responseJsonSchema;
  }

  return {
    type: "object",
    properties: respSchema,
  };
}

// All routes implemented
// - Correct URL
// - Correct method
// - Correct query?
// - Correct headers?
// - Correct body?
// - Correct return type
