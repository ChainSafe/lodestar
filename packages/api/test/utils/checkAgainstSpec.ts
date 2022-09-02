import Ajv, {ErrorObject} from "ajv";
import {expect} from "chai";
import {ReqGeneric, ReqSerializer, ReturnTypes, RouteDef} from "../../src/utils/types.js";
import {applyRecursively, OpenApiJson, parseOpenApiSpec, ParseOpenApiSpecOpts} from "./parseOpenApiSpec.js";
import {GenericServerTestCases} from "./genericServerTest.js";

const ajv = new Ajv({
  // strict: true,
  // strictSchema: true,
  allErrors: true,
});

// TODO: Still necessary?
ajv.addKeyword({
  keyword: "example",
  validate: () => true,
  errors: false,
});

ajv.addFormat("hex", /^0x[a-fA-F0-9]+$/);

export function runTestCheckAgainstSpec(
  openApiJson: OpenApiJson,
  routesData: Record<string, RouteDef>,
  reqSerializers: Record<string, ReqSerializer<any, any>>,
  returnTypes: Record<string, ReturnTypes<any>[string]>,
  testDatas: Record<string, GenericServerTestCases<any>[string]>,
  opts?: ParseOpenApiSpecOpts
): void {
  const openApiSpec = parseOpenApiSpec(openApiJson, opts);

  for (const [operationId, routeSpec] of openApiSpec.entries()) {
    describe(operationId, () => {
      const {requestSchema, responseOkSchema} = routeSpec;
      const routeId = operationId as keyof typeof testDatas;
      const testData = testDatas[routeId];
      const routeData = routesData[routeId];

      before("route is defined", () => {
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

          if (operationId === "publishBlock" || operationId === "publishBlindedBlock") {
            // For some reason AJV invalidates valid blocks if multiple forks are defined with oneOf
            // `.data - should match exactly one schema in oneOf`
            // Dropping all definitions except (phase0) pases the validation
            if (routeSpec.requestSchema?.oneOf) {
              routeSpec.requestSchema = routeSpec.requestSchema?.oneOf[0];
            }
          }

          // Stringify param and query to simulate rendering in HTTP query
          // TODO: Review conversions in fastify and other servers
          stringifyProperties((reqJson as ReqGeneric).params ?? {});
          stringifyProperties((reqJson as ReqGeneric).query ?? {});

          // Validate response
          validateSchema(routeSpec.requestSchema, reqJson, "request");
        });
      }

      if (responseOkSchema) {
        it(`${operationId}_response`, function () {
          const resJson = returnTypes[operationId].toJson(testData.res as any);

          // Patch for getBlockV2
          if (operationId === "getBlockV2" || operationId === "getStateV2") {
            // For some reason AJV invalidates valid blocks if multiple forks are defined with oneOf
            // `.data - should match exactly one schema in oneOf`
            // Dropping all definitions except (phase0) pases the validation
            if (responseOkSchema.properties?.data.oneOf) {
              responseOkSchema.properties.data = responseOkSchema.properties.data.oneOf[1];
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

function stringifyProperties(obj: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === "number") {
      obj[key] = value.toString(10);
    }
  }

  return obj;
}
