import Ajv, {ErrorObject} from "ajv";
import {expect, describe, beforeAll, it} from "vitest";
import {WireFormat} from "../../src/utils/wireFormat.js";
import {Endpoint, RequestWithBodyCodec, RouteDefinitions, isRequestWithoutBody} from "../../src/utils/types.js";
import {applyRecursively, JsonSchema, OpenApiJson, parseOpenApiSpec} from "./parseOpenApiSpec.js";
import {GenericServerTestCases} from "./genericServerTest.js";

const ajv = new Ajv({
  strict: true,
});

// Ensure embedded schema 'example' do not fail validation
ajv.addKeyword({
  keyword: "example",
  validate: () => true,
  errors: false,
});

ajv.addFormat("hex", /^0x[a-fA-F0-9]+$/);

/**
 * A set of properties that will be ignored during tests execution.
 * This allows for a black-list mechanism to have a test pass while some part of the spec is not yet implemented.
 *
 * Properties can be nested using dot notation, following JSONPath semantic.
 *
 * Example:
 * - query
 * - query.skip_randao_verification
 */
export type IgnoredProperty = {
  /**
   * Properties to ignore in the request schema
   */
  request?: string[];
  /**
   * Properties to ignore in the response schema
   */
  response?: string[];
};

/**
 * Recursively remove a property from a schema
 *
 * @param schema Schema to remove a property from
 * @param property JSONPath like property to remove from the schema
 */
function deleteNested(schema: JsonSchema | undefined, property: string): void {
  const properties = schema?.properties;
  if (property.includes(".")) {
    // Extract first segment, keep the rest as dotted
    const [key, ...rest] = property.split(".");
    deleteNested(properties?.[key], rest.join("."));
  } else {
    // Remove property from 'required'
    if (schema?.required) {
      schema.required = schema.required?.filter((e) => property !== e);
    }
    // Remove property from 'properties'
    delete properties?.[property];
  }
}

export function runTestCheckAgainstSpec<Es extends Record<string, Endpoint>>(
  openApiJson: OpenApiJson,
  definitions: RouteDefinitions<Es>,
  testCases: GenericServerTestCases<Es>,
  ignoredOperations: string[] = [],
  ignoredProperties: Record<string, IgnoredProperty> = {}
): void {
  const openApiSpec = parseOpenApiSpec(openApiJson);

  for (const [operationId, routeSpec] of openApiSpec.entries()) {
    const isIgnored = ignoredOperations.some((id) => id === operationId);
    if (isIgnored) {
      continue;
    }

    const ignoredProperty = ignoredProperties[operationId];

    describe(operationId, () => {
      const {requestSchema, responseOkSchema} = routeSpec;
      const routeId = operationId;
      const testData = testCases[routeId];
      const routeDef = definitions[routeId];

      beforeAll(() => {
        if (routeDef == null) {
          throw Error(`No routeDef for ${routeId}`);
        }
        if (testData == null) {
          throw Error(`No testData for ${routeId}`);
        }
      });

      it(`${operationId}_route`, function () {
        expect(routeDef.method.toLowerCase()).toBe(routeSpec.method.toLowerCase());
        expect(routeDef.url).toBe(routeSpec.url);
      });

      if (requestSchema != null) {
        it(`${operationId}_request`, function () {
          const reqJson = isRequestWithoutBody(routeDef)
            ? routeDef.req.writeReq(testData.args)
            : (routeDef.req as RequestWithBodyCodec<Es[string]>).writeReqJson(testData.args);

          // Stringify param and query to simulate rendering in HTTP query
          stringifyProperties(reqJson.params ?? {});
          stringifyProperties(reqJson.query ?? {});

          const ignoredProperties = ignoredProperty?.request;
          if (ignoredProperties) {
            // Remove ignored properties from schema validation
            for (const property of ignoredProperties) {
              deleteNested(routeSpec.requestSchema, property);
            }
          }

          // Validate request
          validateSchema(routeSpec.requestSchema, reqJson, "request");

          // Verify that request supports ssz if required by spec
          if (routeSpec.requestSszRequired) {
            try {
              const reqCodec = routeDef.req as RequestWithBodyCodec<Es[string]>;
              const reqSsz = reqCodec.writeReqSsz(testData.args);

              expect(reqSsz.body).toBeInstanceOf(Uint8Array);
              expect(reqCodec.onlySupport).not.toBe(WireFormat.json);
            } catch (_e) {
              throw Error("Must support ssz request body");
            }
          }
        });
      }

      if (responseOkSchema) {
        it(`${operationId}_response`, function () {
          const data = routeDef.resp.data.toJson(testData.res?.data, testData.res?.meta);
          const metaJson = routeDef.resp.meta.toJson(testData.res?.meta);
          const headers = parseHeaders(routeDef.resp.meta.toHeadersObject(testData.res?.meta));

          let resJson: unknown;
          if (routeDef.resp.transform) {
            resJson = routeDef.resp.transform.toResponse(data, metaJson);
          } else {
            resJson = {
              data,
              ...(metaJson as object),
            };
          }

          const ignoredProperties = ignoredProperty?.response;
          if (ignoredProperties) {
            // Remove ignored properties from schema validation
            for (const property of ignoredProperties) {
              deleteNested(routeSpec.responseOkSchema, property);
            }
          }
          // Validate response
          validateSchema(responseOkSchema, {headers, body: resJson}, "response");

          // Verify that response supports ssz if required by spec
          if (routeSpec.responseSszRequired) {
            try {
              const sszBytes = routeDef.resp.data.serialize(testData.res?.data, testData.res?.meta);

              expect(sszBytes).toBeInstanceOf(Uint8Array);
              expect(routeDef.resp.onlySupport).not.toBe(WireFormat.json);
            } catch (_e) {
              throw Error("Must support ssz response body");
            }
          }
        });
      }
    });
  }
}

function validateSchema(schema: Parameters<typeof ajv.compile>[0], json: unknown, id: string): void {
  let validate: ReturnType<typeof ajv.compile>;

  try {
    validate = ajv.compile(schema);
  } catch (e) {
    console.error(JSON.stringify(schema, null, 2));
    (e as Error).message = `${id} schema - ${(e as Error).message}`;
    throw e;
  }

  const valid = <boolean>validate(json);
  if (!valid) {
    // Remove descriptions, for better clarity in rendering on errors
    applyRecursively(schema, (obj) => {
      delete obj.description;
    });

    throw Error(
      [
        `Invalid ${id} against spec schema`,
        prettyAjvErrors(validate.errors),
        // Limit the max amount of JSON dumped as the full state is too big
        JSON.stringify(json).slice(0, 1000),
        // Dump schema too
        JSON.stringify(schema).slice(0, 1000),
      ].join("\n\n")
    );
  }
}

function prettyAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors) return "";
  return errors.map((e) => `${e.instancePath ?? "."} - ${e.message}`).join("\n");
}

type StringifiedProperty = string | StringifiedProperty[];

function stringifyProperty(value: unknown): StringifiedProperty {
  if (typeof value === "number") {
    return value.toString(10);
  }

  if (Array.isArray(value)) {
    return value.map(stringifyProperty);
  }
  return String(value);
}

function stringifyProperties(obj: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    obj[key] = stringifyProperty(value);
  }

  return obj;
}

/**
 * Parse headers before schema validation, the spec expects `{schema: type: boolean}` for
 * headers with boolean values but values are converted to string when setting the headers
 */
function parseHeaders(headers: Record<string, string>): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (const key of Object.keys(headers)) {
    const value = headers[key];
    parsed[key] = /true|false/.test(value) ? value === "true" : value;
  }
  return parsed;
}
