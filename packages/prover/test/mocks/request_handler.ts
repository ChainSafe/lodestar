import sinon from "sinon";
import {NetworkName} from "@lodestar/config/networks";
import {ForkConfig} from "@lodestar/config";
import {getEmptyLogger} from "@lodestar/logger/empty";
import {ELVerifiedRequestHandlerOpts} from "../../src/interfaces.js";
import {ProofProvider} from "../../src/proof_provider/proof_provider.js";
import {ELRequestPayload, ELResponse} from "../../src/types.js";
import {ELBlock, ELTransaction} from "../../src/types.js";
import {isNullish} from "../../src/utils/validation.js";

type Writeable<T> = {
  -readonly [K in keyof T]?: T[K] extends object ? Writeable<T[K]> : T[K];
};

export interface TestFixture<R = unknown, P = unknown[]> {
  label: string;
  network: string;
  request: ELRequestPayload<P>;
  response: Writeable<ELResponse<R>>;
  execution: {
    block: ELBlock;
  };
  beacon: {
    executionPayload: Record<string, unknown>;
    headers: {header: {message: {slot: string}}};
  };
  dependentRequests: {payload: ELRequestPayload; response: Writeable<ELResponse>}[];
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

function getPayloadMatcher(expected: ELRequestPayload): sinon.SinonMatcher {
  return sinon.match(function (value: ELRequestPayload): boolean {
    if (value.method !== expected.method || value.params.length !== expected.params.length) {
      return false;
    }

    for (let i = 0; i < value.params.length; i++) {
      const item = value.params[i];
      const expectedItem = expected.params[i];

      if (typeof item === "string" && typeof expectedItem === "string") {
        if (item.toLowerCase() === expectedItem.toLowerCase()) {
          continue;
        } else {
          return false;
        }
      }

      // Param is a transaction object
      if (typeof item === "object" && !isNullish((item as ELTransaction).to)) {
        if (matchTransaction(item as ELTransaction, expectedItem as ELTransaction)) {
          continue;
        } else {
          return false;
        }
      }
    }

    return true;
  }, "payload match params");
}

export function generateReqHandlerOptionsMock(
  data: TestFixture,
  config: ForkConfig
): Omit<ELVerifiedRequestHandlerOpts<any, any>, "payload"> {
  const executionPayload = config
    .getExecutionForkTypes(parseInt(data.beacon.headers.header.message.slot))
    .ExecutionPayload.fromJson(data.beacon.executionPayload);

  const options = {
    handler: sinon.stub(),
    logger: getEmptyLogger(),
    proofProvider: {
      getExecutionPayload: sinon.stub().resolves(executionPayload),
    } as unknown as ProofProvider,
    network: data.network as NetworkName,
  };

  options.handler.withArgs(getPayloadMatcher(data.request)).resolves(data.response);

  for (const req of data.dependentRequests) {
    options.handler.withArgs(getPayloadMatcher(req.payload)).resolves(req.response);
  }

  options.handler
    .withArgs({
      jsonrpc: sinon.match.any,
      id: sinon.match.any,
      method: "eth_getBlockByNumber",
      params: [data.execution.block.number, true],
    })
    .resolves({id: 1233, jsonrpc: "2.0", result: data.execution.block});

  options.handler
    .withArgs({
      jsonrpc: sinon.match.any,
      id: sinon.match.any,
      method: "eth_getBlockByHash",
      params: [data.execution.block.hash, true],
    })
    .resolves({id: 1233, jsonrpc: "2.0", result: data.execution.block});

  return options;
}
