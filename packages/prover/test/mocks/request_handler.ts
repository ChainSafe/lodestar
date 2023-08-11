import sinon from "sinon";
import deepmerge from "deepmerge";
import {NetworkName} from "@lodestar/config/networks";
import {ForkConfig} from "@lodestar/config";
import {PresetName} from "@lodestar/params";
import {getEmptyLogger} from "@lodestar/logger/empty";
import {ELVerifiedRequestHandlerOpts} from "../../src/interfaces.js";
import {ProofProvider} from "../../src/proof_provider/proof_provider.js";
import {
  ELBlock,
  ELTransaction,
  JsonRpcBatchRequest,
  JsonRpcBatchResponse,
  JsonRpcRequestOrBatch,
  JsonRpcRequestPayload,
  JsonRpcResponse,
  JsonRpcResponseOrBatch,
  JsonRpcVersion,
} from "../../src/types.js";
import {isNullish} from "../../src/utils/validation.js";
import {isBatchRequest, mergeBatchReqResp} from "../../src/utils/json_rpc.js";

type Writeable<T> = {
  -readonly [K in keyof T]?: T[K] extends object ? Writeable<T[K]> : T[K];
};

export function cloneTestFixture<T extends object>(source: T, ...extra: object[]): GenericTestFixture<T> {
  return deepmerge.all([{}, source, ...extra]) as GenericTestFixture<T>;
}

// Because of compatibility of types with web3.js we have to consider "jsonrpc" strictly to be "2.0" | "1.0"
// not the generic string. The test fixtures are auto-generated which coerce the type of "jsonrpc" to string.
// So we have to create more flexible types here to avoid type errors.
// Simple solution for tests could be just use `as any` but it's not a good practice.
export type GenericTestFixture<T> = {
  [K in keyof T]: T[K] extends object ? GenericTestFixture<T[K]> : K extends "jsonrpc" ? JsonRpcVersion : T[K];
};

export interface TestFixture<R = unknown, P = unknown[]> {
  label: string;
  network: string;
  request: JsonRpcRequestPayload<P>;
  response: Writeable<JsonRpcResponse<R>>;
  execution: {
    block: ELBlock;
  };
  beacon: {
    executionPayload: Record<string, unknown>;
    headers: {header: {message: {slot: string}}};
  };
  dependentRequests: {payload: JsonRpcRequestOrBatch; response: Writeable<JsonRpcResponseOrBatch>}[];
}

function matchTransaction(value: ELTransaction, expected: ELTransaction): boolean {
  if (
    value.to?.toLowerCase() !== expected.to?.toLowerCase() ||
    value.from.toLocaleLowerCase() !== expected.from.toLowerCase()
  ) {
    return false;
  }

  if ("value" in value && value.value.toLowerCase() !== expected.value.toLowerCase()) {
    return false;
  }

  if ("data" in value && value.data?.toLowerCase() !== expected.data?.toLowerCase()) {
    return false;
  }

  return true;
}

function matchParams(params: unknown[], expected: unknown[]): boolean {
  for (let i = 0; i < params.length; i++) {
    const item = params[i];
    const expectedItem = expected[i];

    if (typeof item === "string" && typeof expectedItem === "string") {
      if (item.toLowerCase() === expectedItem.toLowerCase()) continue;

      return false;
    }

    // Param is a transaction object
    if (typeof item === "object" && !isNullish((item as ELTransaction).to)) {
      if (matchTransaction(item as ELTransaction, expectedItem as ELTransaction)) continue;

      return false;
    }
  }

  return true;
}

function getPayloadParamsMatcher(expected: unknown[]): sinon.SinonMatcher {
  return sinon.match(function (params: unknown[]): boolean {
    return matchParams(params, expected);
  }, "payload match params");
}

function getBatchPayloadMatcher(expected: JsonRpcBatchRequest): sinon.SinonMatcher {
  return sinon.match(function (value: JsonRpcBatchRequest): boolean {
    for (const [index, item] of value.entries()) {
      if (item.method !== expected[index].method) return false;
      if (!matchParams(item.params, expected[index].params)) return false;
    }
    return true;
  }, "batch payload match");
}

export function generateReqHandlerOptionsMock(
  data: TestFixture,
  config: ForkConfig
): Omit<ELVerifiedRequestHandlerOpts<any>, "payload"> {
  const executionPayload = config
    .getExecutionForkTypes(parseInt(data.beacon.headers.header.message.slot))
    .ExecutionPayload.fromJson(data.beacon.executionPayload);

  const options = {
    logger: getEmptyLogger(),
    proofProvider: {
      getExecutionPayload: sinon.stub().resolves(executionPayload),
      config: {
        ...config,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        PRESET_BASE: data.network as unknown as PresetName,
      },
      network: data.network,
    } as unknown as ProofProvider,
    network: data.network as NetworkName,
    rpc: {
      request: sinon.stub(),
      batchRequest: sinon.stub(),
      getRequestId: () => (Math.random() * 10000).toFixed(0),
    },
  };

  options.rpc.request
    .withArgs(data.request.method, getPayloadParamsMatcher(data.request.params), sinon.match.any)
    .resolves(data.response);

  for (const {payload, response} of data.dependentRequests) {
    if (isBatchRequest(payload)) {
      options.rpc.batchRequest
        .withArgs(getBatchPayloadMatcher(payload), sinon.match.any)
        .resolves(mergeBatchReqResp(payload, response as JsonRpcBatchResponse));
    } else {
      options.rpc.request
        .withArgs(payload.method, getPayloadParamsMatcher(payload.params), sinon.match.any)
        .resolves(response);
    }
  }

  options.rpc.request
    .withArgs("eth_getBlockByNumber", [data.execution.block.number, true], sinon.match.any)
    .resolves({id: 1233, jsonrpc: "2.0", result: data.execution.block});

  options.rpc.request
    .withArgs("eth_getBlockByHash", [data.execution.block.hash, true], sinon.match.any)
    .resolves({id: 1233, jsonrpc: "2.0", result: data.execution.block});

  return options as unknown as Omit<ELVerifiedRequestHandlerOpts<any>, "payload">;
}
