import sinon from "sinon";
import {NetworkName} from "@lodestar/config/networks";
import {ForkConfig} from "@lodestar/config";
import {getEnvLogger} from "@lodestar/logger/env";
import {PresetName} from "@lodestar/params";
import {ELVerifiedRequestHandlerOpts} from "../../src/interfaces.js";
import {ProofProvider} from "../../src/proof_provider/proof_provider.js";
import {ELRequestPayload, ELResponse} from "../../src/types.js";
import {ELBlock} from "../../src/types.js";

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

export function generateReqHandlerOptionsMock(
  data: TestFixture,
  config: ForkConfig
): Omit<ELVerifiedRequestHandlerOpts<any, any>, "payload"> {
  const executionPayload = config
    .getExecutionForkTypes(parseInt(data.beacon.headers.header.message.slot))
    .ExecutionPayload.fromJson(data.beacon.executionPayload);

  const options = {
    handler: sinon.stub(),
    logger: getEnvLogger(),
    proofProvider: {
      getExecutionPayload: sinon.stub().resolves(executionPayload),
      config: {
        ...config,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        PRESET_BASE: data.network as unknown as PresetName,
      },
    } as unknown as ProofProvider,
    network: data.network as NetworkName,
  };

  options.handler
    .withArgs({jsonrpc: sinon.match.any, id: sinon.match.any, method: data.request.method, params: data.request.params})
    .resolves(data.response);

  for (const req of data.dependentRequests) {
    options.handler
      .withArgs({jsonrpc: sinon.match.any, id: sinon.match.any, method: req.payload.method, params: req.payload.params})
      .resolves(req.response);
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
