import Ajv, {ErrorObject} from "ajv";
import {expect, describe, beforeAll, it} from "vitest";
import {ReqGeneric, ReqSerializer, ReturnTypes, RouteDef} from "../../src/utils/types.js";
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

export function runTestCheckAgainstSpec(
  openApiJson: OpenApiJson,
  routesData: Record<string, RouteDef>,
  reqSerializers: Record<string, ReqSerializer<any, any>>,
  returnTypes: Record<string, ReturnTypes<any>[string]>,
  testDatas: Record<string, GenericServerTestCases<any>[string]>,
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
      const testData = testDatas[routeId];
      const routeData = routesData[routeId];

      beforeAll(() => {
        if (routeData == null) {
          throw Error(`No routeData for ${routeId}`);
        }
        if (testData == null) {
          throw Error(`No testData for ${routeId}`);
        }
      });

      it(`${operationId}_route`, function () {
        expect(routeData.method.toLowerCase()).to.equal(routeSpec.method.toLowerCase(), "Wrong method");
        expect(routeData.url).to.equal(routeSpec.url, "Wrong url");
      });

      if (requestSchema != null) {
        it(`${operationId}_request`, function () {
          const reqJson = reqSerializers[routeId].writeReq(...(testData.args as [never])) as unknown;

          // Stringify param and query to simulate rendering in HTTP query
          // TODO: Review conversions in fastify and other servers
          stringifyProperties((reqJson as ReqGeneric).params ?? {});
          stringifyProperties((reqJson as ReqGeneric).query ?? {});

          const ignoredProperties = ignoredProperty?.request;
          if (ignoredProperties) {
            // Remove ignored properties from schema validation
            for (const property of ignoredProperties) {
              deleteNested(routeSpec.requestSchema, property);
            }
          }

          // Validate request
          validateSchema(routeSpec.requestSchema, reqJson, "request");
        });
      }

      if (responseOkSchema) {
        it(`${operationId}_response`, function () {
          const resJson = returnTypes[operationId].toJson(testData.res as any);

          const ignoredProperties = ignoredProperty?.response;
          if (ignoredProperties) {
            // Remove ignored properties from schema validation
            for (const property of ignoredProperties) {
              deleteNested(routeSpec.responseOkSchema, property);
            }
          }
          // Validate response
          validateSchema(responseOkSchema, resJson, "response");
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
    // eslint-disable-next-line no-console
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
  } else if (Array.isArray(value)) {
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
