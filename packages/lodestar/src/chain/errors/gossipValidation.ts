import {LodestarError} from "@chainsafe/lodestar-utils";
import {PeerAction} from "../../network";

export enum GossipAction {
  IGNORE = "IGNORE",
  REJECT = "REJECT",
}

export class GossipActionError<T extends {code: string}> extends LodestarError<T> {
  /** The action at gossipsub side */
  action: GossipAction;
  /** The action at node side */
  lodestarAction?: PeerAction;

  constructor(action: GossipAction, type: T, lodestarAction?: PeerAction) {
    super(type);
    this.action = action;
    this.lodestarAction = lodestarAction;
  }
}
