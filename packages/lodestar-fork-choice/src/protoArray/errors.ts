import {Epoch} from "@chainsafe/lodestar-types";
import {HexRoot} from "./interface";

export enum ProtoArrayErrorCode {
  ERR_FINALIZED_NODE_UNKNOWN = "ERR_FINALIZED_NODE_UNKNOWN",
  ERR_JUSTIFIED_NODE_UNKNOWN = "ERR_JUSTIFIED_NODE_UNKNOWN",
  ERR_INVALID_FINALIZED_ROOT_CHANGE = "ERR_INVALID_FINALIZED_ROOT_CHANGE",
  ERR_INVALID_NODE_INDEX = "ERR_INVALID_NODE_INDEX",
  ERR_INVALID_PARENT_INDEX = "ERR_INVALID_PARENT_INDEX",
  ERR_INVALID_BEST_CHILD_INDEX = "ERR_INVALID_BEST_CHILD_INDEX",
  ERR_INVALID_JUSTIFIED_INDEX = "ERR_INVALID_JUSTIFIED_INDEX",
  ERR_INVALID_BEST_DESCENDANT_INDEX = "ERR_INVALID_BEST_DESCENDANT_INDEX",
  ERR_INVALID_PARENT_DELTA = "ERR_INVALID_PARENT_DELTA",
  ERR_INVALID_NODE_DELTA = "ERR_INVALID_NODE_DELTA",
  ERR_INDEX_OVERFLOW = "ERR_INDEX_OVERFLOW",
  ERR_INVALID_DELTA_LEN = "ERR_INVALID_DELTA_LEN",
  ERR_REVERTED_FINALIZED_EPOCH = "ERR_REVERTED_FINALIZED_EPOCH",
  ERR_INVALID_BEST_NODE = "ERR_INVALID_BEST_NODE",
}

export type ProtoArrayErrorType =
  | {
      code: ProtoArrayErrorCode.ERR_FINALIZED_NODE_UNKNOWN;
      root: HexRoot;
    }
  | {
      code: ProtoArrayErrorCode.ERR_JUSTIFIED_NODE_UNKNOWN;
      root: HexRoot;
    }
  | {
      code: ProtoArrayErrorCode.ERR_INVALID_FINALIZED_ROOT_CHANGE;
    }
  | {
      code: ProtoArrayErrorCode.ERR_INVALID_NODE_INDEX;
      index: number;
    }
  | {
      code: ProtoArrayErrorCode.ERR_INVALID_PARENT_INDEX;
      index: number;
    }
  | {
      code: ProtoArrayErrorCode.ERR_INVALID_BEST_CHILD_INDEX;
      index: number;
    }
  | {
      code: ProtoArrayErrorCode.ERR_INVALID_JUSTIFIED_INDEX;
      index: number;
    }
  | {
      code: ProtoArrayErrorCode.ERR_INVALID_BEST_DESCENDANT_INDEX;
      index: number;
    }
  | {
      code: ProtoArrayErrorCode.ERR_INVALID_PARENT_DELTA;
      index: number;
    }
  | {
      code: ProtoArrayErrorCode.ERR_INVALID_NODE_DELTA;
      index: number;
    }
  | {
      code: ProtoArrayErrorCode.ERR_INDEX_OVERFLOW;
      value: string;
    }
  | {
      code: ProtoArrayErrorCode.ERR_INVALID_DELTA_LEN;
      deltas: number;
      indices: number;
    }
  | {
      code: ProtoArrayErrorCode.ERR_REVERTED_FINALIZED_EPOCH;
      currentFinalizedEpoch: Epoch;
      newFinalizedEpoch: Epoch;
    }
  | {
      code: ProtoArrayErrorCode.ERR_INVALID_BEST_NODE;
      startRoot: HexRoot;
      justifiedEpoch: Epoch;
      finalizedEpoch: Epoch;
      headRoot: HexRoot;
      headJustifiedEpoch: Epoch;
      headFinalizedEpoch: Epoch;
    };

export class ProtoArrayError extends Error {
  public type: ProtoArrayErrorType;
  constructor(type: ProtoArrayErrorType) {
    super();
    this.type = type;
  }
}
