import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig, defaultChainConfig} from "@lodestar/config";
import {DataAvailabilityStatus, ExecutionPayloadStatus} from "../../../src/block/externalData.js";
import type {StateTransitionOpts} from "../../../src/stateTransition.js";
import type {IBeaconStateView, IBeaconStateViewNative} from "../../../src/stateView/interface.js";
import {NativeBeaconStateView} from "../../../src/stateView/nativeBeaconStateView.js";

describe("NativeBeaconStateView", () => {
  const config = createBeaconConfig(defaultChainConfig, new Uint8Array(32));

  it("throws for Gloas-only fields while native Gloas is unsupported", () => {
    const binding = {} as IBeaconStateViewNative;
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
    } as unknown as IBeaconStateViewNative;

    const view = new NativeBeaconStateView(binding, config);
    expect(view.fork).toBe(fakeFork);
    expect(view.fork).toBe(fakeFork);
    expect(view.latestBlockHeader).toBe(fakeHeader);
    expect(view.latestBlockHeader).toBe(fakeHeader);
    expect(forkAccessCount).toBe(1);
    expect(latestBlockHeaderAccessCount).toBe(1);
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

  it("forwards serialized block bytes and blinded flag to native stateTransition", () => {
    type NativeStateTransitionBytes = (
      blockBytes: Uint8Array,
      isBlinded: boolean,
      options: StateTransitionOpts
    ) => IBeaconStateView;

    const blockBytes = new Uint8Array([1, 2, 3]);
    const options: StateTransitionOpts = {
      executionPayloadStatus: ExecutionPayloadStatus.valid,
      dataAvailabilityStatus: DataAvailabilityStatus.Available,
      verifyStateRoot: false,
    };
    const postBinding = {} as IBeaconStateViewNative;
    const binding = {
      stateTransition: vi.fn(() => postBinding),
    } as unknown as IBeaconStateViewNative;

    const view = new NativeBeaconStateView(binding, config) as NativeBeaconStateView & {
      stateTransition: NativeStateTransitionBytes;
    };
    const postState = view.stateTransition(blockBytes, true, options);

    expect(binding.stateTransition).toHaveBeenCalledWith(blockBytes, true, options);
    expect(postState).toBeInstanceOf(NativeBeaconStateView);
    expect((postState as NativeBeaconStateView).binding).toBe(postBinding);
  });
});
