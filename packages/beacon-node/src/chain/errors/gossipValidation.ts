import {LodestarError} from "@lodestar/utils";

export enum GossipAction {
  IGNORE = "IGNORE",
  REJECT = "REJECT",
}

export enum GossipErrorCode {
  INVALID_SERIALIZED_BYTES_ERROR_CODE = "GOSSIP_ERROR_INVALID_SERIALIZED_BYTES",
  PAST_SLOT = "GOSSIP_ERROR_PAST_SLOT",
}

export class GossipActionError<T extends {code: string}> extends LodestarError<T> {
  action: GossipAction;

  constructor(action: GossipAction, type: T) {
    super(type);
    this.action = action;
  }
}
