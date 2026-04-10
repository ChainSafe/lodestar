import {fromHexString} from "@chainsafe/ssz";
import {config} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {computeTotalBalance} from "../../../src/forkChoice/store.js";
import {
  ExecutionStatus,
  ForkChoice,
  IForkChoiceStore,
  PayloadStatus,
  ProtoArray,
  ProtoBlock,
} from "../../../src/index.js";

const genesisSlot = 0;
const genesisEpoch = 0;
const genesisRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";

function slotRoot(slot: number): string {
  return "0x" + String(slot).padStart(64, "0");
}

export type Opts = {
  initialBlockCount: number;
  initialValidatorCount: number;
  initialEquivocatedCount: number;
  fastConfirmation?: boolean;
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
      dataAvailabilityStatus: DataAvailabilityStatus.PreData,

      parentBlockHash: null,
      payloadStatus: PayloadStatus.FULL,
    } as Omit<ProtoBlock, "targetRoot">,
    genesisSlot
  );

  const balances = new Uint16Array(Array.from({length: opts.initialValidatorCount}, () => 32));

  // The first block of epoch 1 is used as the confirmed root.
  // This ensures confirmedEpoch + 1 >= currentEpoch so findLatestConfirmedDescendant runs.
  const epoch1StartSlot = SLOTS_PER_EPOCH;
  const confirmedBlockRoot = slotRoot(epoch1StartSlot);

  const fcStore: IForkChoiceStore = {
    currentSlot: genesisSlot,
    justified: {
      checkpoint: {
        epoch: genesisEpoch,
        root: fromHexString(genesisRoot),
        rootHex: genesisRoot,
        payloadStatus: PayloadStatus.FULL,
      },
      balances,
      totalBalance: computeTotalBalance(balances),
    },
    unrealizedJustified: {
      checkpoint: {
        epoch: genesisEpoch,
        root: fromHexString(genesisRoot),
        rootHex: genesisRoot,
        payloadStatus: PayloadStatus.FULL,
      },
      balances,
    },
    finalizedCheckpoint: {
      epoch: genesisEpoch,
      root: fromHexString(genesisRoot),
      rootHex: genesisRoot,
      payloadStatus: PayloadStatus.FULL,
    },
    unrealizedFinalizedCheckpoint: {
      epoch: genesisEpoch,
      root: fromHexString(genesisRoot),
      rootHex: genesisRoot,
      payloadStatus: PayloadStatus.FULL,
    },
    justifiedBalancesGetter: () => balances,
    equivocatingIndices: new Set(Array.from({length: opts.initialEquivocatedCount}, (_, i) => i)),
    confirmedRoot: confirmedBlockRoot,
    previousEpochObservedJustifiedCheckpoint: {
      epoch: genesisEpoch,
      root: fromHexString(genesisRoot),
      rootHex: genesisRoot,
    },
    currentEpochObservedJustifiedCheckpoint: {
      epoch: 1,
      root: fromHexString(confirmedBlockRoot),
      rootHex: confirmedBlockRoot,
    },
    previousEpochGreatestUnrealizedCheckpoint: {
      epoch: 1,
      root: fromHexString(confirmedBlockRoot),
      rootHex: confirmedBlockRoot,
    },
    previousEpochObservedJustifiedBalances: balances,
    currentEpochObservedJustifiedBalances: balances,
    previousEpochGreatestUnrealizedBalances: balances,
    previousSlotHead: genesisRoot,
    currentSlotHead: genesisRoot,
    stateGetter: () => null,
  };

  const forkchoice = new ForkChoice(config, fcStore, protoArr, opts.initialValidatorCount, null, {
    fastConfirmation: opts.fastConfirmation,
  });
  let parentBlockRoot = genesisRoot;

  for (let slot = 1; slot < opts.initialBlockCount; slot++) {
    const blockRoot = slotRoot(slot);
    // Set unrealizedJustifiedEpoch to 1 for blocks in epoch 1+
    // so that headJustification.epoch + 1 >= currentEpoch passes in loop 2
    const blockEpoch = Math.floor(slot / SLOTS_PER_EPOCH);
    const unrealizedJustifiedEpoch = blockEpoch >= 1 ? 1 : genesisEpoch;

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
      unrealizedJustifiedEpoch,
      unrealizedJustifiedRoot: genesisRoot,
      unrealizedFinalizedEpoch: genesisEpoch,
      unrealizedFinalizedRoot: genesisRoot,

      executionPayloadBlockHash: null,
      executionStatus: ExecutionStatus.PreMerge,

      timeliness: false,
      dataAvailabilityStatus: DataAvailabilityStatus.PreData,

      parentBlockHash: null,
      payloadStatus: PayloadStatus.FULL,
    };

    protoArr.onBlock(block, block.slot, null);
    parentBlockRoot = blockRoot;
  }

  return forkchoice;
}
