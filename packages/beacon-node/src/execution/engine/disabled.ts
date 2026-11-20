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

  getPayloadBodiesByHashV2(): Promise<never> {
    throw Error("Execution engine disabled");
  }

  getBlobs(): Promise<never> {
    throw Error("Execution engine disabled");
  }

  supportsGetBlobsV4(): boolean {
    return false;
  }

  getBlobsV4(): Promise<never> {
    throw Error("Execution engine disabled");
  }

  setCustodyColumns(): void {}

  getInclusionList(): Promise<never> {
    throw Error("Execution engine disabled");
  }
}
