import {describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig, defaultChainConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {FAR_FUTURE_EPOCH, ForkName, ForkSeq, MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {DataAvailabilityStatus, ExecutionPayloadStatus} from "../../../src/index.js";
import type {StateTransitionOpts} from "../../../src/stateTransition.js";
import {BeaconStateView} from "../../../src/stateView/beaconStateView.js";
import {computeNewStateRootStateTransitionOpts} from "../../../src/stateView/computeNewStateRoot.js";
import type {IBeaconStateViewNative} from "../../../src/stateView/interface.js";
import {NativeBeaconStateView} from "../../../src/stateView/nativeBeaconStateView.js";
import {createBeaconStateView} from "../../../src/stateView/stateViewFactory.js";
import {generateValidators} from "../../utils/validator.js";

describe("NativeBeaconStateView", () => {
  const genesisValidatorsRoot = new Uint8Array(32);
  const config = createBeaconConfig(defaultChainConfig, genesisValidatorsRoot);
  const bellatrixConfig = createBeaconConfig(
    {...defaultChainConfig, ALTAIR_FORK_EPOCH: 0, BELLATRIX_FORK_EPOCH: 0},
    genesisValidatorsRoot
  );

  it.each([
    {fork: ForkName.phase0, executionState: false},
    {fork: ForkName.altair, executionState: false},
    {fork: ForkName.bellatrix, executionState: true},
    {fork: ForkName.capella, executionState: true},
    {fork: ForkName.deneb, executionState: true},
    {fork: ForkName.electra, executionState: true},
    {fork: ForkName.fulu, executionState: true},
    {fork: ForkName.gloas, executionState: true},
  ])("matches TypeScript execution predicates for a $fork state", ({fork, executionState}) => {
    const config = createBeaconConfig(getConfig(fork), genesisValidatorsRoot);
    const slot = 3 * SLOTS_PER_EPOCH;
    const stateType = config.getForkTypes(slot).BeaconState;
    const state = stateType.defaultValue();
    state.slot = slot;
    state.validators = generateValidators(16, {
      activation: 0,
      exit: FAR_FUTURE_EPOCH,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
      balance: MAX_EFFECTIVE_BALANCE,
    });
    state.balances = state.validators.map(() => MAX_EFFECTIVE_BALANCE);
    if ("inactivityScores" in state) {
      state.inactivityScores = state.validators.map(() => 0);
      state.previousEpochParticipation = state.validators.map(() => 0);
      state.currentEpochParticipation = state.validators.map(() => 0);
      state.currentSyncCommittee.pubkeys.fill(state.validators[0].pubkey);
      state.nextSyncCommittee.pubkeys.fill(state.validators[0].pubkey);
    }
    if ("latestExecutionPayloadHeader" in state) {
      state.latestExecutionPayloadHeader.blockHash = new Uint8Array(32).fill(7);
    }
    if ("latestBlockHash" in state) state.latestBlockHash = new Uint8Array(32).fill(7);
    pubkeyCache.ensureCapacity(state.validators.length);
    const stateBytes = stateType.serialize(state);
    const tree = createBeaconStateView({nativeStateTransition: false, config, stateBytes});
    const native = createBeaconStateView({nativeStateTransition: true, config, stateBytes});
    try {
      if (!(tree instanceof BeaconStateView) || !(native instanceof NativeBeaconStateView)) {
        throw Error("Expected TypeScript and native state views");
      }
      expect(tree.isExecutionStateType).toBe(executionState);
      expect(native.isExecutionStateType).toBe(tree.isExecutionStateType);
      expect(native.isMergeTransitionComplete).toBe(tree.isMergeTransitionComplete);
      const block = config.getForkTypes(state.slot).BeaconBlock.defaultValue();
      expect(native.isExecutionEnabled(block)).toBe(tree.isExecutionEnabled(block));
    } finally {
      native.release();
      tree.release();
    }
  });

  it("rejects Heze before invoking native slot processing or state loading", () => {
    const hezeConfig = createBeaconConfig(
      {
        ...defaultChainConfig,
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: 0,
        GLOAS_FORK_EPOCH: 0,
        HEZE_FORK_EPOCH: 0,
      },
      genesisValidatorsRoot
    );
    const binding = {processSlots: vi.fn(), loadOtherState: vi.fn()} as unknown as IBeaconStateViewNative;
    const view = new NativeBeaconStateView(hezeConfig, binding);
    expect(() => view.processSlots(0)).toThrow("does not support heze");
    expect(() => view.loadOtherState(ssz.gloas.BeaconState.serialize(ssz.gloas.BeaconState.defaultValue()))).toThrow(
      "does not support heze"
    );
    expect(binding.processSlots).not.toHaveBeenCalled();
    expect(binding.loadOtherState).not.toHaveBeenCalled();
  });

  it("preserves Gloas availability bits and repeated PTC membership", () => {
    const availability = {uint8Array: new Uint8Array([0b10000101]), bitLen: 8};
    const binding = {
      executionPayloadAvailability: availability,
      getIndicesInPayloadTimelinessCommittee: () => [0, 3, 7],
    } as unknown as IBeaconStateViewNative;
    const view = new NativeBeaconStateView(config, binding);

    expect(view.executionPayloadAvailability.getTrueBitIndexes()).toEqual([0, 2, 7]);
    expect(view.executionPayloadAvailability).toBe(view.executionPayloadAvailability);
    expect(view.getIndicesInPayloadTimelinessCommittee(0, 0)).toEqual([0, 3, 7]);
  });

  it("serializes all parent request lists and returns a separately owned view", () => {
    const requests = ssz.gloas.ExecutionRequests.defaultValue();
    requests.builderDeposits.push(ssz.gloas.BuilderDepositRequest.defaultValue());
    requests.builderExits.push(ssz.gloas.BuilderExitRequest.defaultValue());
    const postBinding = {forkName: "gloas", release: vi.fn()} as unknown as IBeaconStateViewNative;
    const binding = {
      withParentPayloadApplied: vi.fn(() => postBinding),
      release: vi.fn(),
    } as unknown as IBeaconStateViewNative;
    const view = new NativeBeaconStateView(config, binding);
    const post = view.withParentPayloadApplied(requests);
    const [bytes] = vi.mocked(binding.withParentPayloadApplied).mock.calls[0];
    expect(ssz.gloas.ExecutionRequests.deserialize(bytes)).toEqual(requests);
    post.release();
    expect(postBinding.release).toHaveBeenCalledOnce();
    expect(binding.release).not.toHaveBeenCalled();
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

    const view = new NativeBeaconStateView(config, binding);
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

    new NativeBeaconStateView(config, binding).release();

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

    const view = new NativeBeaconStateView(config, binding);
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

    const view = new NativeBeaconStateView(config, binding);
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

    const result = await new NativeBeaconStateView(config, binding).computeBlockRewards(block, proposerRewards);

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

    const result = new NativeBeaconStateView(config, binding).computeNewStateRoot({block}, {});

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
