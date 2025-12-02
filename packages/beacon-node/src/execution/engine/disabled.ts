import {ExecutionEngineState, IExecutionEngine, PayloadIdCache} from "./interface.js";

export class ExecutionEngineDisabled implements IExecutionEngine {
  state = ExecutionEngineState.OFFLINE;

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

  getBlobs(): Promise<never> {
    throw Error("Execution engine disabled");
  }
}
