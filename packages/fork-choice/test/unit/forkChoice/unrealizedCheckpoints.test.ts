import {Mock, describe, expect, it, vi} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {createChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {Epoch, Slot, phase0, ssz} from "@lodestar/types";
import {ExecutionStatus, ForkChoice, ProtoArray, ProtoBlock} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {VALIDATOR_COUNT, genesisSlot, makeStore, toProtoBlock} from "./proposerHeadTestUtils.js";

const config = createChainForkConfig({});
const blockEpoch = 2;
const parentSlot = blockEpoch * SLOTS_PER_EPOCH + 1;
const blockSlot = parentSlot + 1;

function checkpoint(epoch: Epoch): phase0.Checkpoint {
  return {epoch, root: fromHexString(getBlockRoot(epoch * SLOTS_PER_EPOCH))};
}

function setup(): {
  forkChoice: ForkChoice;
  state: IBeaconStateView;
  computeUnrealizedCheckpoints: Mock;
} {
  const genesisRoot = getBlockRoot(genesisSlot);
  const protoArray = ProtoArray.initialize(toProtoBlock(genesisSlot, genesisRoot, false), genesisSlot);
  protoArray.onBlock(
    toProtoBlock(parentSlot, genesisRoot, false, {
      unrealizedJustifiedEpoch: blockEpoch,
      unrealizedJustifiedRoot: getBlockRoot(blockEpoch * SLOTS_PER_EPOCH),
      unrealizedFinalizedEpoch: blockEpoch - 1,
      unrealizedFinalizedRoot: getBlockRoot((blockEpoch - 1) * SLOTS_PER_EPOCH),
    }),
    parentSlot,
    null
  );

  const computeUnrealizedCheckpoints = vi.fn(() => ({
    justifiedCheckpoint: checkpoint(blockEpoch - 1),
    finalizedCheckpoint: checkpoint(0),
  }));
  const state = {
    currentJustifiedCheckpoint: checkpoint(0),
    finalizedCheckpoint: checkpoint(0),
    computeUnrealizedCheckpoints,
    getBlockRootAtSlot: (slot: Slot) => fromHexString(getBlockRoot(slot)),
    isExecutionStateType: false,
  } as unknown as IBeaconStateView;

  const forkChoice = new ForkChoice(
    config,
    {...makeStore(), currentSlot: blockSlot},
    protoArray,
    VALIDATOR_COUNT,
    null,
    {computeUnrealized: true}
  );
  return {forkChoice, state, computeUnrealizedCheckpoints};
}

function importBlock(addSlashing?: (body: phase0.BeaconBlockBody) => void): {
  protoBlock: ProtoBlock;
  computeUnrealizedCheckpoints: Mock;
} {
  const {forkChoice, state, computeUnrealizedCheckpoints} = setup();
  const block = ssz.phase0.BeaconBlock.defaultValue();
  block.slot = blockSlot;
  block.parentRoot = fromHexString(getBlockRoot(parentSlot));
  addSlashing?.(block.body);
  const protoBlock = forkChoice.onBlock(
    block,
    state,
    0,
    0,
    blockSlot,
    ExecutionStatus.PreMerge,
    DataAvailabilityStatus.PreData
  );
  return {protoBlock, computeUnrealizedCheckpoints};
}

describe("Forkchoice / onBlock unrealized checkpoints", () => {
  it("reuses the parent unrealized checkpoints for a same-epoch block without slashings", () => {
    const {protoBlock, computeUnrealizedCheckpoints} = importBlock();

    expect(computeUnrealizedCheckpoints).not.toHaveBeenCalled();
    expect(protoBlock.unrealizedJustifiedEpoch).toBe(blockEpoch);
    expect(protoBlock.unrealizedFinalizedEpoch).toBe(blockEpoch - 1);
  });

  it.each<[string, (body: phase0.BeaconBlockBody) => void]>([
    ["a proposer slashing", (body) => body.proposerSlashings.push(ssz.phase0.ProposerSlashing.defaultValue())],
    ["an attester slashing", (body) => body.attesterSlashings.push(ssz.phase0.AttesterSlashing.defaultValue())],
  ])("recomputes the unrealized checkpoints for a same-epoch block with %s", (_, addSlashing) => {
    const {protoBlock, computeUnrealizedCheckpoints} = importBlock(addSlashing);

    expect(computeUnrealizedCheckpoints).toHaveBeenCalledOnce();
    expect(protoBlock.unrealizedJustifiedEpoch).toBe(blockEpoch - 1);
    expect(protoBlock.unrealizedFinalizedEpoch).toBe(0);
  });
});
