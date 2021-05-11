import {LodestarError} from "@chainsafe/lodestar-utils";

export enum GossipAction {
  IGNORE = "IGNORE",
  REJECT = "REJECT",
}

export class GossipValidationError<T extends {code: string}> extends LodestarError<T> {
  action: GossipAction;

  constructor(action: GossipAction, type: T) {
    super(type);
    this.action = action;
  }
}
