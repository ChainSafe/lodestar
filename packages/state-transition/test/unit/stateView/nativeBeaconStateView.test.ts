import {describe, expect, it, vi} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {DataAvailabilityStatus, ExecutionPayloadStatus} from "../../../src/index.js";
import type {StateTransitionOpts} from "../../../src/stateTransition.js";
import {computeNewStateRootStateTransitionOpts} from "../../../src/stateView/computeNewStateRoot.js";
import {ForkSeq} from "@lodestar/params";
import type {IBeaconStateViewNative} from "../../../src/stateView/interface.js";
import {NativeBeaconStateView} from "../../../src/stateView/nativeBeaconStateView.js";

describe("NativeBeaconStateView", () => {
  it("lifts the raw {uint8Array, bitLen} into a BitArray for executionPayloadAvailability", () => {
    // 0b10100101 — bits at indices 0, 2, 5, 7 are set
    const uint8Array = new Uint8Array([0b10100101]);
    const bitLen = 8;

    let fetchCount = 0;
    const binding = {
      get executionPayloadAvailability() {
        fetchCount++;
        return {uint8Array, bitLen};
      },
    } as unknown as IBeaconStateViewNative;

    const view = new NativeBeaconStateView(binding);
    const bits = view.executionPayloadAvailability;

    expect(bits).toBeInstanceOf(BitArray);
    expect(bits.bitLen).toBe(bitLen);
    expect(bits.uint8Array).toBe(uint8Array);
    expect(bits.get(0)).toBe(true);
    expect(bits.get(1)).toBe(false);
    expect(bits.get(2)).toBe(true);
    expect(bits.get(5)).toBe(true);
    expect(bits.get(7)).toBe(true);

    // Cached: a second access doesn't go back to the binding
    expect(view.executionPayloadAvailability).toBe(bits);
    expect(fetchCount).toBe(1);
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

    const view = new NativeBeaconStateView(binding);
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

    const view = new NativeBeaconStateView(binding);
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
    const postBinding = {} as IBeaconStateViewNative;
    const binding = {
      stateTransition: vi.fn(() => postBinding),
    } as unknown as IBeaconStateViewNative;

    const view = new NativeBeaconStateView(binding);
    const postState = view.stateTransition(blockBytes, block, options, {});

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
      proposerRewards: {attestations: 1, syncAggregate: 2, slashing: 3},
      hashTreeRoot: () => stateRoot,
    } as unknown as IBeaconStateViewNative;
    const binding = {
      stateTransition: vi.fn(() => postBinding),
    } as unknown as IBeaconStateViewNative;

    const result = new NativeBeaconStateView(binding).computeNewStateRoot({block, ssz: blockBytes}, {});

    expect(binding.stateTransition).toHaveBeenCalledWith(blockBytes, isBlinded, computeNewStateRootStateTransitionOpts);
    expect(result.newStateRoot).toBe(stateRoot);
    expect(result.proposerReward).toBe(6n);
    expect(result.postState).toBeInstanceOf(NativeBeaconStateView);
  });

  it("rejects state root computation without serialized block bytes", () => {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    const binding = {
      stateTransition: vi.fn(),
    } as unknown as IBeaconStateViewNative;

    expect(() => new NativeBeaconStateView(binding).computeNewStateRoot({block}, {})).toThrow(
      "Serialized block bytes are required to compute a state root with NativeBeaconStateView"
    );
    expect(binding.stateTransition).not.toHaveBeenCalled();
  });
});
