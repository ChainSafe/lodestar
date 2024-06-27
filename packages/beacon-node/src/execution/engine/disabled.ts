import {ClientVersion, ExecutionEngineState, IExecutionEngine, PayloadIdCache} from "./interface.js";

export class ExecutionEngineDisabled implements IExecutionEngine {
  readonly payloadIdCache = new PayloadIdCache();

  async notifyNewPayload(): Promise<never> {
    throw Error("Execution engine disabled");
  }

  async notifyForkchoiceUpdate(): Promise<never> {
    throw Error("Execution engine disabled");
  }

  async getPayload(): Promise<never> {
    throw Error("Execution engine disabled");
  }

  async getBlobsBundle(): Promise<never> {
    throw Error("Execution engine disabled");
  }

  getPayloadBodiesByHash(): Promise<never> {
    throw Error("Execution engine disabled");
  }

  getPayloadBodiesByRange(): Promise<never> {
    throw Error("Execution engine disabled");
  }

  getClientVersion(): Promise<ClientVersion[]> {
    throw Error("Execution engine disabled");
  }

  getState(): ExecutionEngineState {
    throw Error("Execution engine disabled");
  }

  getExecutionClientVersion(): ClientVersion {
    throw Error("Execution engine disabled");
  }

  getConsensusClientVersion(): ClientVersion {
    throw Error("Execution engine disabled");
  }
}
