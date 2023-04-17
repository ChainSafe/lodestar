import {LodestarError} from "@lodestar/utils";

export enum GossipAction {
  IGNORE = "IGNORE",
  REJECT = "REJECT",
}

export const INVALID_SERIALIZED_BYTES_ERROR_CODE = "GOSSIP_ERROR_INVALID_SERIALIZED_BYTES";

export class GossipActionError<T extends {code: string}> extends LodestarError<T> {
  action: GossipAction;

  constructor(action: GossipAction, type: T) {
    super(type);
    this.action = action;
  }
}
