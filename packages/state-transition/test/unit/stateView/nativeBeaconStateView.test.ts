import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig, defaultChainConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {DataAvailabilityStatus, ExecutionPayloadStatus} from "../../../src/index.js";
import type {StateTransitionOpts} from "../../../src/stateTransition.js";
import {computeNewStateRootStateTransitionOpts} from "../../../src/stateView/computeNewStateRoot.js";
import type {IBeaconStateViewNative} from "../../../src/stateView/interface.js";
import {NativeBeaconStateView} from "../../../src/stateView/nativeBeaconStateView.js";

describe("NativeBeaconStateView", () => {
  const genesisValidatorsRoot = new Uint8Array(32);
  const config = createBeaconConfig(defaultChainConfig, genesisValidatorsRoot);
  const bellatrixConfig = createBeaconConfig(
    {...defaultChainConfig, ALTAIR_FORK_EPOCH: 0, BELLATRIX_FORK_EPOCH: 0},
    genesisValidatorsRoot
  );

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

  it("releases the native binding", () => {
    const binding = {
      release: vi.fn(),
    } as unknown as IBeaconStateViewNative;

    new NativeBeaconStateView(binding, config).release();

    expect(binding.release).toHaveBeenCalledOnce();
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
  ])("uses provided bytes and derives the blinded flag for a $blockType block", ({block, isBlinded}) => {
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

    const view = new NativeBeaconStateView(binding, config);
    const postState = view.stateTransition({block, ssz: blockBytes}, options, {});

    expect(binding.stateTransition).toHaveBeenCalledWith(blockBytes, isBlinded, options);
    expect(postState).toBeInstanceOf(NativeBeaconStateView);
    expect((postState as NativeBeaconStateView).binding).toBe(postBinding);
  });

  it("serializes blocks for native block reward computation", async () => {
    const block = ssz.phase0.BeaconBlock.defaultValue();
    const proposerRewards = {attestations: 1, syncAggregate: 2, slashing: 3};
    const blockRewards = {
      proposerIndex: 0,
      total: 6,
      attestations: 1,
      syncAggregate: 2,
      proposerSlashings: 0,
      attesterSlashings: 3,
    };
    const binding = {
      computeBlockRewards: vi.fn(() => blockRewards),
    } as unknown as IBeaconStateViewNative;

    const result = await new NativeBeaconStateView(binding, config).computeBlockRewards(block, proposerRewards);

    expect(binding.computeBlockRewards).toHaveBeenCalledWith(
      ssz.phase0.SignedBeaconBlock.serialize({message: block, signature: new Uint8Array(96)}),
      false,
      proposerRewards
    );
    expect(result).toBe(blockRewards);
  });

  it.each([
    {
      blockType: "full",
      block: ssz.phase0.SignedBeaconBlock.defaultValue(),
      isBlinded: false,
      config,
      expectedBytes: ssz.phase0.SignedBeaconBlock.serialize(ssz.phase0.SignedBeaconBlock.defaultValue()),
    },
    {
      blockType: "blinded",
      block: ssz.bellatrix.SignedBlindedBeaconBlock.defaultValue(),
      isBlinded: true,
      config: bellatrixConfig,
      expectedBytes: ssz.bellatrix.SignedBlindedBeaconBlock.serialize(
        ssz.bellatrix.SignedBlindedBeaconBlock.defaultValue()
      ),
    },
  ])("serializes a $blockType block when bytes are not provided", ({block, isBlinded, config, expectedBytes}) => {
    const stateRoot = new Uint8Array(32).fill(1);
    const postBinding = {
      proposerRewards: {attestations: 1, syncAggregate: 2, slashing: 3},
      hashTreeRoot: () => stateRoot,
    } as unknown as IBeaconStateViewNative;
    const binding = {
      stateTransition: vi.fn(() => postBinding),
    } as unknown as IBeaconStateViewNative;

    const result = new NativeBeaconStateView(binding, config).computeNewStateRoot({block}, {});

    expect(binding.stateTransition).toHaveBeenCalledWith(
      expectedBytes,
      isBlinded,
      computeNewStateRootStateTransitionOpts
    );
    expect(result.newStateRoot).toBe(stateRoot);
    expect(result.proposerReward).toBe(6n);
    expect(result.postState).toBeInstanceOf(NativeBeaconStateView);
  });
});
