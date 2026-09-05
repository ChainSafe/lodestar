import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig, defaultChainConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, ForkSeq, SLOTS_PER_EPOCH} from "@lodestar/params";
import {isBlindedBeaconBlock, ssz} from "@lodestar/types";
import {DataAvailabilityStatus, ExecutionPayloadStatus} from "../../../src/index.js";
import type {StateTransitionOpts} from "../../../src/stateTransition.js";
import {computeNewStateRootStateTransitionOpts} from "../../../src/stateView/computeNewStateRoot.js";
import type {IBeaconStateViewNative} from "../../../src/stateView/interface.js";
import {NativeBeaconStateView} from "../../../src/stateView/nativeBeaconStateView.js";

describe("NativeBeaconStateView", () => {
  const config = createBeaconConfig(defaultChainConfig, new Uint8Array(32));

  it("throws for Gloas-only fields while native Gloas is unsupported", () => {
    const binding = {slot: 0} as IBeaconStateViewNative;
    const view = new NativeBeaconStateView(binding, config);

    expect(() => view.executionPayloadAvailability).toThrow("NativeBeaconStateView does not support Gloas");
    expect(() => view.latestBlockHash).toThrow("NativeBeaconStateView does not support Gloas");
    expect(() => view.getIndicesInPayloadTimelinessCommittee(0, 0)).toThrow(
      "NativeBeaconStateView does not support Gloas"
    );
  });

  it("caches forwarded properties so the binding is hit once", () => {
    let forkAccessCount = 0;
    let latestBlockHeaderAccessCount = 0;
    let forkSeqAccessCount = 0;
    const fakeFork = {previousVersion: new Uint8Array(4), currentVersion: new Uint8Array(4), epoch: 0};
    const fakeHeader = {
      slot: 0,
      proposerIndex: 0,
      parentRoot: new Uint8Array(32),
      stateRoot: new Uint8Array(32),
      bodyRoot: new Uint8Array(32),
    };

    const binding = {
      slot: 0,
      get fork() {
        forkAccessCount++;
        return fakeFork;
      },
      get latestBlockHeader() {
        latestBlockHeaderAccessCount++;
        return fakeHeader;
      },
      get forkSeq() {
        forkSeqAccessCount++;
        return ForkSeq.electra;
      },
    } as unknown as IBeaconStateViewNative;

    const view = new NativeBeaconStateView(binding, config);
    expect(view.fork).toBe(fakeFork);
    expect(view.fork).toBe(fakeFork);
    expect(view.latestBlockHeader).toBe(fakeHeader);
    expect(view.latestBlockHeader).toBe(fakeHeader);
    expect(view.forkSeq).toBe(ForkSeq.electra);
    expect(view.forkSeq).toBe(ForkSeq.electra);
    expect(forkAccessCount).toBe(1);
    expect(latestBlockHeaderAccessCount).toBe(1);
    expect(forkSeqAccessCount).toBe(1);
  });

  it("delegates pass-through getters and methods to the binding", () => {
    const binding = {
      slot: 123,
      epoch: 4,
      validatorCount: 17,
      getBlockRootAtSlot: (slot: number) => new Uint8Array([slot & 0xff]),
      getBalance: (index: number) => 32_000_000_000 + index,
    } as unknown as IBeaconStateViewNative;

    const view = new NativeBeaconStateView(binding, config);
    expect(view.slot).toBe(123);
    expect(view.epoch).toBe(4);
    expect(view.validatorCount).toBe(17);
    expect(view.getBlockRootAtSlot(7)).toEqual(new Uint8Array([7]));
    expect(view.getBalance(2)).toBe(32_000_000_002);
  });

  it.each([
    {
      blockType: "full",
      block: ssz.bellatrix.SignedBeaconBlock.defaultValue(),
      isBlinded: false,
    },
    {
      blockType: "blinded",
      block: ssz.bellatrix.SignedBlindedBeaconBlock.defaultValue(),
      isBlinded: true,
    },
  ])("derives the blinded flag for a $blockType block", ({block, isBlinded}) => {
    const blockBytes = new Uint8Array([1, 2, 3]);
    const options: StateTransitionOpts = {
      verifyStateRoot: false,
      executionPayloadStatus: ExecutionPayloadStatus.valid,
      dataAvailabilityStatus: DataAvailabilityStatus.Available,
    };
    const postBinding = {slot: 0} as IBeaconStateViewNative;
    const binding = {
      slot: 0,
      stateTransition: vi.fn(() => postBinding),
    } as unknown as IBeaconStateViewNative;

    const view = new NativeBeaconStateView(binding, config);
    const postState = view.stateTransition({block, ssz: blockBytes}, options, {});

    expect(binding.stateTransition).toHaveBeenCalledWith(blockBytes, isBlinded, options);
    expect(postState).toBeInstanceOf(NativeBeaconStateView);
    expect((postState as NativeBeaconStateView).binding).toBe(postBinding);
  });

  it.each([
    {
      blockType: "full",
      block: ssz.bellatrix.SignedBeaconBlock.defaultValue(),
      isBlinded: false,
    },
    {
      blockType: "blinded",
      block: ssz.bellatrix.SignedBlindedBeaconBlock.defaultValue(),
      isBlinded: true,
    },
  ])("computes a state root from $blockType block bytes", ({block, isBlinded}) => {
    const blockBytes = new Uint8Array([1, 2, 3]);
    const stateRoot = new Uint8Array(32).fill(1);
    const postBinding = {
      slot: 0,
      proposerRewards: {attestations: 1, syncAggregate: 2, slashing: 3},
      hashTreeRoot: () => stateRoot,
    } as unknown as IBeaconStateViewNative;
    const binding = {
      slot: 0,
      stateTransition: vi.fn(() => postBinding),
    } as unknown as IBeaconStateViewNative;

    const result = new NativeBeaconStateView(binding, config).computeNewStateRoot({block, ssz: blockBytes}, {});

    expect(binding.stateTransition).toHaveBeenCalledWith(blockBytes, isBlinded, computeNewStateRootStateTransitionOpts);
    expect(result.newStateRoot).toBe(stateRoot);
    expect(result.proposerReward).toBe(6n);
    expect(result.postState).toBeInstanceOf(NativeBeaconStateView);
  });

  it.each([false, true])("serializes a missing Bellatrix block with blinded=%s", (isBlinded) => {
    const schema = isBlinded ? ssz.bellatrix.SignedBlindedBeaconBlock : ssz.bellatrix.SignedBeaconBlock;
    const block = schema.defaultValue();
    const bellatrixConfig = createBeaconConfig(getConfig(ForkName.bellatrix), new Uint8Array(32));
    const root = new Uint8Array(32).fill(3);
    const postBinding = {
      slot: 0,
      hashTreeRoot: () => root,
      proposerRewards: {attestations: 0, syncAggregate: 0, slashing: 0},
    } as unknown as IBeaconStateViewNative;
    const binding = {slot: 0, stateTransition: vi.fn(() => postBinding)} as unknown as IBeaconStateViewNative;
    const result = new NativeBeaconStateView(binding, bellatrixConfig).computeNewStateRoot({block}, {});
    expect(result.newStateRoot).toEqual(root);
    expect(binding.stateTransition).toHaveBeenCalledWith(
      isBlindedBeaconBlock(block.message)
        ? ssz.bellatrix.SignedBlindedBeaconBlock.serialize({message: block.message, signature: block.signature})
        : ssz.bellatrix.SignedBeaconBlock.serialize({message: block.message, signature: block.signature}),
      isBlinded,
      computeNewStateRootStateTransitionOpts
    );
  });

  it("rejects creation of a Gloas view with a specific error", () => {
    const gloasConfig = createBeaconConfig(getConfig(ForkName.gloas), new Uint8Array(32));
    const binding = {slot: 0} as IBeaconStateViewNative;
    expect(() => new NativeBeaconStateView(binding, gloasConfig)).toThrowError(
      expect.objectContaining({type: expect.objectContaining({code: "NATIVE_STF_UNSUPPORTED_FORK"})})
    );
  });

  it("does not run Gloas builder preverification on Fulu states", () => {
    const binding = {slot: 0, pendingDepositsCount: 5} as IBeaconStateViewNative;
    const result = new NativeBeaconStateView(binding, config).preVerifyBuilderDepositsPreGloas(10, 100);
    expect(result.scannedPendingDeposits).toBe(0);
    expect(result.totalCachedDeposits).toBe(0);
    expect(result.pendingDepositsCount).toBe(5);
  });

  it.each([ForkName.gloas, ForkName.heze])("rejects every native advance into %s", (fork) => {
    const boundaryConfig = createBeaconConfig(
      {...getConfig(ForkName.heze), GLOAS_FORK_EPOCH: 1, HEZE_FORK_EPOCH: 2},
      new Uint8Array(32)
    );
    const slot = (fork === ForkName.gloas ? 1 : 2) * SLOTS_PER_EPOCH;
    const binding = {
      slot: 0,
      stateTransition: () => {
        throw new Error("unexpected native transition");
      },
      processSlots: () => {
        throw new Error("unexpected native slot processing");
      },
      loadOtherState: () => {
        throw new Error("unexpected native reload");
      },
    } as unknown as IBeaconStateViewNative;
    const view = new NativeBeaconStateView(binding, boundaryConfig);
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    const state = ssz.phase0.BeaconState.defaultValue();
    state.slot = slot;
    const bytes = ssz.phase0.BeaconState.serialize(state);
    const operations = {
      processSlots: () => view.processSlots(slot),
      stateTransition: () => view.stateTransition({block}, computeNewStateRootStateTransitionOpts, {}),
      computeNewStateRoot: () => view.computeNewStateRoot({block}, {}),
      loadOtherState: () => view.loadOtherState(bytes),
    };
    for (const [name, operation] of Object.entries(operations)) {
      expect(operation, name).toThrowError(
        expect.objectContaining({type: expect.objectContaining({code: "NATIVE_STF_UNSUPPORTED_FORK", fork, slot})})
      );
    }
  });
});
