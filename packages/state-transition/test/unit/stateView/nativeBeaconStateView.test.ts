import {describe, expect, it} from "vitest";
import {createBeaconConfig, defaultChainConfig} from "@lodestar/config";
import type {IBeaconStateViewNative} from "../../../src/stateView/interface.js";
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
});
