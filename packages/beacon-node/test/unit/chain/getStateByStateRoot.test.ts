import {describe, expect, it, vi} from "vitest";
import {ExecutionStatus, ProtoBlock} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView, IBeaconStateView} from "@lodestar/state-transition";
import {fromHex, toRootHex} from "@lodestar/utils";
import {BeaconChain} from "../../../src/chain/chain.js";
import {RegenCaller} from "../../../src/chain/regen/interface.js";
import {generateCachedState} from "../../utils/state.js";
import {generateProtoBlock} from "../../utils/typeGenerator.js";

describe("BeaconChain getStateByStateRoot", () => {
  const rootHex = `0x${"aa".repeat(32)}`;
  const checkpointState = new BeaconStateView(generateCachedState({slot: 2 * SLOTS_PER_EPOCH}));
  const stateRoot = toRootHex(checkpointState.hashTreeRoot());

  function setup(
    state: IBeaconStateView,
    {
      cachedCheckpointState = checkpointState,
      finalizedBlock = generateProtoBlock({slot: checkpointState.slot, blockRoot: rootHex, stateRoot}),
      finalizedEpoch = 2,
    }: {
      cachedCheckpointState?: IBeaconStateView | null;
      finalizedBlock?: ProtoBlock;
      finalizedEpoch?: number;
    } = {}
  ) {
    const chain = {
      forkChoice: {
        getFinalizedBlock: vi.fn().mockReturnValue(finalizedBlock),
        getFinalizedCheckpoint: vi.fn().mockReturnValue({epoch: finalizedEpoch, root: fromHex(rootHex), rootHex}),
        getBlockDefaultStatus: vi.fn().mockReturnValue(finalizedBlock),
      },
      regen: {
        getStateSync: vi.fn().mockReturnValue(null),
        getCheckpointStateSync: vi.fn().mockReturnValue(cachedCheckpointState),
        getState: vi.fn().mockResolvedValue(state),
      },
    };

    const getStateByStateRoot = (root: string) =>
      BeaconChain.prototype.getStateByStateRoot.call(chain as unknown as BeaconChain, root, {allowRegen: true});
    return {chain, getStateByStateRoot};
  }

  it.each([
    [ExecutionStatus.Valid, false],
    [ExecutionStatus.Syncing, true],
  ])(
    "serves an aligned finalized checkpoint with execution status %s",
    async (executionStatus, executionOptimistic) => {
      const finalizedBlock = generateProtoBlock({
        slot: checkpointState.slot,
        blockRoot: rootHex,
        stateRoot,
        executionStatus,
      });
      const {chain, getStateByStateRoot} = setup(checkpointState, {finalizedBlock});

      expect(await getStateByStateRoot(stateRoot)).toEqual({
        state: checkpointState,
        executionOptimistic,
        finalized: true,
      });
      expect(chain.regen.getCheckpointStateSync).toHaveBeenCalledWith({epoch: 2, rootHex});
      expect(chain.regen.getState).not.toHaveBeenCalled();
    }
  );

  it("falls through to regen when the finalized block is not at the epoch start slot", async () => {
    const blockState = new BeaconStateView(generateCachedState({slot: checkpointState.slot - 1}));
    const blockStateRoot = toRootHex(blockState.hashTreeRoot());
    const finalizedBlock = generateProtoBlock({slot: blockState.slot, blockRoot: rootHex, stateRoot: blockStateRoot});
    const {chain, getStateByStateRoot} = setup(blockState, {finalizedBlock});

    expect(await getStateByStateRoot(blockStateRoot)).toEqual({
      state: blockState,
      executionOptimistic: false,
      finalized: true,
    });
    expect(chain.regen.getCheckpointStateSync).not.toHaveBeenCalled();
    expect(chain.regen.getState).toHaveBeenCalledWith(blockStateRoot, RegenCaller.restApi);
  });

  it("preserves regen for non-finalized state roots without checking the checkpoint cache", async () => {
    const state = new BeaconStateView(generateCachedState({slot: 3 * SLOTS_PER_EPOCH}));
    const root = toRootHex(state.hashTreeRoot());
    const {chain, getStateByStateRoot} = setup(state);

    expect(await getStateByStateRoot(root)).toEqual({state, executionOptimistic: false, finalized: false});
    expect(chain.regen.getCheckpointStateSync).not.toHaveBeenCalled();
    expect(chain.regen.getState).toHaveBeenCalledWith(root, RegenCaller.restApi);
  });

  it("falls through to regen when the finalized checkpoint is absent from memory", async () => {
    const {chain, getStateByStateRoot} = setup(checkpointState, {cachedCheckpointState: null});

    expect(await getStateByStateRoot(stateRoot)).toEqual({
      state: checkpointState,
      executionOptimistic: false,
      finalized: true,
    });
    expect(chain.regen.getCheckpointStateSync).toHaveBeenCalledWith({epoch: 2, rootHex});
    expect(chain.regen.getState).toHaveBeenCalledWith(stateRoot, RegenCaller.restApi);
  });

  it("serves the genesis checkpoint state as not finalized", async () => {
    const state = new BeaconStateView(generateCachedState({slot: 0}));
    const root = toRootHex(state.hashTreeRoot());
    const finalizedBlock = generateProtoBlock({blockRoot: rootHex, stateRoot: root});
    const {chain, getStateByStateRoot} = setup(state, {
      cachedCheckpointState: state,
      finalizedBlock,
      finalizedEpoch: 0,
    });

    expect(await getStateByStateRoot(root)).toEqual({state, executionOptimistic: false, finalized: false});
    expect(chain.regen.getCheckpointStateSync).toHaveBeenCalledWith({epoch: 0, rootHex});
    expect(chain.regen.getState).not.toHaveBeenCalled();
  });
});
