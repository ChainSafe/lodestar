import {ValidatorIndex, Epoch, ExecutionAddress} from "@chainsafe/lodestar-types";
import {MapDef} from "../util/map";
import {IExecutionEngine} from "./interface";

export class ExecutionEngineDisabled implements IExecutionEngine {
  readonly proposers = new MapDef<ValidatorIndex, {epoch: Epoch; feeRecipient: ExecutionAddress}>(() => ({
    epoch: 0,
    feeRecipient: Buffer.alloc(20, 0),
  }));

  async notifyNewPayload(): Promise<never> {
    throw Error("Execution engine disabled");
  }

  async notifyForkchoiceUpdate(): Promise<never> {
    throw Error("Execution engine disabled");
  }

  async getPayload(): Promise<never> {
    throw Error("Execution engine disabled");
  }

  async updateProposerPreparation(): Promise<never> {
    throw Error("Execution engine disabled");
  }
}
