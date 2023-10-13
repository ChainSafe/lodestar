export {ProtoArray} from "./protoArray/protoArray.js";
export type {
  ProtoBlock,
  ProtoNode,
  MaybeValidExecutionStatus,
  BlockExecution,
  LVHValidResponse,
  LVHInvalidResponse,
} from "./protoArray/interface.js";
export {ExecutionStatus} from "./protoArray/interface.js";

export {ForkChoice, type ForkChoiceOpts, assertValidTerminalPowBlock} from "./forkChoice/forkChoice.js";
export {
  type IForkChoice,
  type PowBlockHex,
  EpochDifference,
  type AncestorResult,
  AncestorStatus,
  type ForkChoiceMetrics,
} from "./forkChoice/interface.js";
export {
  ForkChoiceStore,
  type IForkChoiceStore,
  type CheckpointWithHex,
  type JustifiedBalancesGetter,
} from "./forkChoice/store.js";
export {
  type InvalidAttestation,
  InvalidAttestationCode,
  type InvalidBlock,
  InvalidBlockCode,
  ForkChoiceError,
  ForkChoiceErrorCode,
} from "./forkChoice/errors.js";
