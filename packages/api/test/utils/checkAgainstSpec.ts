import Ajv, {ErrorObject} from "ajv";
import {expect} from "chai";
import {ReqGeneric, ReqSerializer, ReturnTypes, RouteDef} from "../../src/utils/types.js";
import {OpenApiFile, parseOpenApiSpec} from "./parseOpenApiSpec.js";
import {GenericServerTestCases} from "./genericServerTest.js";
import {fetchOpenApiSpec} from "./fetchOpenApiSpec.js";

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

export async function runTestCheckAgainstSpec(
  openApiFile: OpenApiFile,
  routesData: Record<string, RouteDef>,
  reqSerializers: Record<string, ReqSerializer<any, any>>,
  returnTypes: Record<string, ReturnTypes<any>[string]>,
  testDatas: Record<string, GenericServerTestCases<any>[string]>
): Promise<void> {
  const openApiJson = await fetchOpenApiSpec(openApiFile);
  const openApiSpec = parseOpenApiSpec(openApiJson);

  for (const [operationId, routeSpec] of openApiSpec.entries()) {
    describe(operationId, () => {
      const {requestSchema, responseOkSchema} = routeSpec;
      const routeId = operationId as keyof typeof testDatas;
      const testData = testDatas[routeId];

      before("route is defined", () => {
        if (testData == null) {
          throw Error(`${routeId} not defined`);
        }
      });

      it(`${operationId}_route`, function () {
        const routeData = routesData[routeId];
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
    throw e;
  }

  const valid = <boolean>validate(json);
  if (!valid) {
    throw Error(
      [
        `Invalid ${id} against spec schema`,
        prettyAjvErrors(validate.errors),
        // Limit the max amount of JSON dumped as the full state is too big
        JSON.stringify(json).slice(0, 1000),
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
