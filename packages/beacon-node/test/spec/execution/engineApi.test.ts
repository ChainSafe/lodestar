import {describe, expect, it} from "vitest";
import { EngineApiSpecRepo, fetchOpenRpcSpec } from "../../utils/fetchOpenRpcSpec";
import { MethodName, parseOpenRpcSpec } from "../../utils/parseOpenRpcSpec";
import { EngineApiRpcParamTypes, EngineApiRpcReturnTypes } from "../../../src/execution/engine/types";


const engineApiSpecRepo: EngineApiSpecRepo = {
  url: "https://api.github.com/repos/ethereum/execution-apis/contents",
  specFolder: "src/engine/openrpc",
  baseSchema: "src/schemas",
  commit: "10f58fbface95676780ee7328091a494e9584a6e", // Update as needed
}


const ignoredMethods: MethodName[] = [
  "engine_exchangeCapabilities",
  "engine_exchangeTransitionConfigurationV1",
  "engine_getClientVersionV1" // This method is missing openrpc schema in the spec repo
] 

// Spec
const openRpcJson = await fetchOpenRpcSpec(engineApiSpecRepo);
const engineApiSpec = parseOpenRpcSpec(openRpcJson);

describe("Engine API spec", () => {

  for (const [methodName, method] of engineApiSpec.entries()) {
    if (ignoredMethods.some((m) => m === methodName)) {
      continue;
    }

    it (`${methodName}_route`, () => {
      // Perform compile time check. No run time check
      executionEngineParamTypeHasMethod(methodName as keyof EngineApiRpcParamTypes);
      executionEngineReturnTypeHasMethod(methodName as keyof EngineApiRpcReturnTypes);
    });

    it (`${methodName}_request`, () => {
      expect(methodName).not.toEqual("");
    });

    it (`${methodName}_response`, () => {
      expect(methodName).not.toEqual("");
    });
  }
})


function executionEngineParamTypeHasMethod<M extends keyof EngineApiRpcParamTypes>(method: M): void {
  return;
}
function executionEngineReturnTypeHasMethod<M extends keyof EngineApiRpcReturnTypes>(method: M): void {
  return;
}