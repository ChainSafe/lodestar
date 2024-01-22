import {fromHexString} from "@chainsafe/ssz";
import {config} from "@lodestar/config/default";
import {ExecutionStatus, ForkChoice, IForkChoiceStore, ProtoBlock, ProtoArray} from "../../../src/index.js";
import {computeTotalBalance} from "../../../src/forkChoice/store.js";

const genesisSlot = 0;
const genesisEpoch = 0;
const genesisRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";

export type Opts = {
  // assume there are 64 unfinalized blocks, this number does not make a difference in term of performance
  initialBlockCount: number;
  initialValidatorCount: number;
  initialEquivocatedCount: number;
};

export function initializeForkChoice(opts: Opts): ForkChoice {
  const protoArr = ProtoArray.initialize(
    {
      slot: genesisSlot,
      stateRoot: genesisRoot,
      parentRoot: genesisRoot,
      blockRoot: genesisRoot,

      justifiedEpoch: genesisEpoch,
      justifiedRoot: genesisRoot,
      finalizedEpoch: genesisEpoch,
      finalizedRoot: genesisRoot,

      executionPayloadBlockHash: null,
      executionStatus: ExecutionStatus.PreMerge,
    } as Omit<ProtoBlock, "targetRoot">,
    genesisSlot
  );

  const balances = new Uint8Array(Array.from({length: opts.initialValidatorCount}, () => 32));

  const fcStore: IForkChoiceStore = {
    currentSlot: genesisSlot,
    justified: {
      checkpoint: {epoch: genesisEpoch, root: fromHexString(genesisRoot), rootHex: genesisRoot},
      balances,
      totalBalance: computeTotalBalance(balances),
    },
    unrealizedJustified: {
      checkpoint: {epoch: genesisEpoch, root: fromHexString(genesisRoot), rootHex: genesisRoot},
      balances,
    },
    finalizedCheckpoint: {epoch: genesisEpoch, root: fromHexString(genesisRoot), rootHex: genesisRoot},
    unrealizedFinalizedCheckpoint: {epoch: genesisEpoch, root: fromHexString(genesisRoot), rootHex: genesisRoot},
    justifiedBalancesGetter: () => balances,
    equivocatingIndices: new Set(Array.from({length: opts.initialEquivocatedCount}, (_, i) => i)),
  };

  const forkchoice = new ForkChoice(config, fcStore, protoArr);
  let parentBlockRoot = genesisRoot;

  for (let slot = 1; slot < opts.initialBlockCount; slot++) {
    const blockRoot = "0x" + String(slot).padStart(64, "0");
    const block: ProtoBlock = {
      slot: genesisSlot + slot,
      blockRoot,
      parentRoot: parentBlockRoot,
      stateRoot: blockRoot,
      targetRoot: blockRoot,

      justifiedEpoch: genesisEpoch,
      justifiedRoot: genesisRoot,
      finalizedEpoch: genesisEpoch,
      finalizedRoot: genesisRoot,
      unrealizedJustifiedEpoch: genesisEpoch,
      unrealizedJustifiedRoot: genesisRoot,
      unrealizedFinalizedEpoch: genesisEpoch,
      unrealizedFinalizedRoot: genesisRoot,

      executionPayloadBlockHash: null,
      executionStatus: ExecutionStatus.PreMerge,
    };

    protoArr.onBlock(block, block.slot);
    parentBlockRoot = blockRoot;
  }

  return forkchoice;
}
