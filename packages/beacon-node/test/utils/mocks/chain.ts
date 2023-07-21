import sinon from "sinon";
import {IForkChoice, ProtoBlock, ExecutionStatus, ForkChoice} from "@lodestar/fork-choice";
import {IBeaconChain, BeaconChain} from "../../../src/chain/index.js";
import {ZERO_HASH_HEX} from "../../../src/constants/constants.js";
import {StubbedChainMutable, StubbedOf} from "../stub/index.js";
import {Mutable} from "../types.js";

export function getMockBeaconChain<T extends keyof IBeaconChain>(): StubbedChainMutable<T> {
  return sinon.createStubInstance(BeaconChain) as StubbedChainMutable<T>;
}

export function getMockForkChoice<K extends keyof IForkChoice>(): StubbedOf<Mutable<IForkChoice, K>> {
  return sinon.createStubInstance(ForkChoice) as StubbedOf<Mutable<IForkChoice, K>>;
}

export const zeroProtoBlock: ProtoBlock = {
  slot: 0,
  blockRoot: ZERO_HASH_HEX,
  parentRoot: ZERO_HASH_HEX,
  stateRoot: ZERO_HASH_HEX,
  targetRoot: ZERO_HASH_HEX,

  justifiedEpoch: 0,
  justifiedRoot: ZERO_HASH_HEX,
  finalizedEpoch: 0,
  finalizedRoot: ZERO_HASH_HEX,
  unrealizedJustifiedEpoch: 0,
  unrealizedJustifiedRoot: ZERO_HASH_HEX,
  unrealizedFinalizedEpoch: 0,
  unrealizedFinalizedRoot: ZERO_HASH_HEX,

  ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
};
