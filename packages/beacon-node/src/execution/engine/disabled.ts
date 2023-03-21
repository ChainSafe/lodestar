import {IExecutionEngine, PayloadIdCache} from "./interface.js";

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

  async exchangeTransitionConfigurationV1(): Promise<never> {
    throw Error("Execution engine disabled");
  }

  getPayloadBodiesByHash(): Promise<never> {
    throw Error("Execution engine disabled");
  }

  getPayloadBodiesByRange(): Promise<never> {
    throw Error("Execution engine disabled");
  }
}
