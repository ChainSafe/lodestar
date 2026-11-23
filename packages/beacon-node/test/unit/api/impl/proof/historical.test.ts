import assert from "node:assert/strict";
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {Tree, computeDescriptor} from "@chainsafe/persistent-merkle-tree";
import {createBeaconConfig} from "@lodestar/config";
import * as stateTransition from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {getProofApi} from "../../../../../src/api/impl/proof/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {getHistoricalState} from "../../../../../src/chain/archiveStore/historicalState/getHistoricalState.js";
import {createHistoricalStateRegenMetrics} from "../../../../../src/chain/archiveStore/historicalState/metrics.js";
import {RegenErrorCode} from "../../../../../src/chain/regen/errors.js";
import {RegistryMetricCreator} from "../../../../../src/metrics/index.js";
import {SyncState} from "../../../../../src/sync/index.js";
import {getMockedBeaconSync} from "../../../../mocks/beaconSyncMock.js";
import {getMockedBeaconChain} from "../../../../mocks/mockedBeaconChain.js";
import {startIsolatedTmpBeaconDb} from "../../../../utils/db.js";
import {generateProtoBlock} from "../../../../utils/typeGenerator.js";
import {proofConfig, proofForkSlot} from "./fixtures.js";
import {createTransitionChain, transitionHeadSlot, transitionSlots} from "./transitionFixtures.js";

const backends = process.env.LODESTAR_NATIVE_STATE_TRANSITION === "true" ? [false, true] : [false];
const {BeaconChain} = await vi.importActual<typeof import("../../../../../src/chain/chain.js")>(
  "../../../../../src/chain/chain.js"
);

describe.each(backends)("archive-backed proofs across Gloas (native=%s)", (native) => {
  const chainMock = getMockedBeaconChain({config: proofConfig});
  const modules = {
    chain: chainMock,
    forkChoice: chainMock.forkChoice,
    sync: getMockedBeaconSync(),
    config: proofConfig,
  };
  let api: ReturnType<typeof getProofApi>;
  const ownedStates = new Set<stateTransition.IBeaconStateView>();
  let chain: ReturnType<typeof createTransitionChain>;
  let archive: Awaited<ReturnType<typeof startIsolatedTmpBeaconDb>>;
  let head: stateTransition.IBeaconStateView;
  let storedBlocks: number[];
  let metricsRegister: RegistryMetricCreator;

  beforeAll(async () => {
    chain = createTransitionChain(false);
    head = native
      ? stateTransition.createBeaconStateView({
          nativeStateTransition: true,
          config: createBeaconConfig(proofConfig, chain.anchor.genesisValidatorsRoot),
          stateBytes: chain.stateAt(transitionHeadSlot).serialize(),
        })
      : chain.stateAt(transitionHeadSlot);
    archive = await startIsolatedTmpBeaconDb(proofConfig, "lodestar-proof-history-");
    api = getProofApi(defaultApiOptions, {...modules, db: archive.db});
  });

  afterAll(async () => {
    await archive?.close();
    if (native) head?.release();
    chain?.close();
  });

  beforeEach(async () => {
    metricsRegister = new RegistryMetricCreator();
    const metrics = createHistoricalStateRegenMetrics(metricsRegister);
    await archive.db.stateArchive.batchDelete(await archive.db.stateArchive.keys());
    await archive.db.blockArchive.batchDeleteRange(await archive.db.blockArchive.keys());
    await archive.db.stateArchive.put(chain.anchor.slot, chain.anchor);
    storedBlocks = transitionSlots.filter((slot) => slot < transitionHeadSlot);
    for (const slot of storedBlocks) await archive.db.blockArchive.add(chain.blockAt(slot));
    modules.chain.getHeadState.mockReturnValue(head);
    modules.forkChoice.getFinalizedBlock.mockReturnValue(generateProtoBlock({slot: transitionHeadSlot}));
    Object.defineProperty(modules.chain.clock, "currentSlot", {value: transitionHeadSlot});
    Object.defineProperty(modules.sync, "state", {value: SyncState.Synced});
    const regen = async (slot: number) => {
      const state = await getHistoricalState(
        slot,
        createBeaconConfig(proofConfig, chain.anchor.genesisValidatorsRoot),
        archive.db,
        native,
        metrics
      );
      return state === null ? null : {state, executionOptimistic: false, finalized: true};
    };
    Object.assign(modules.chain, {
      opts: {serveHistoricalState: true},
      archiveStore: {getHistoricalStateBySlot: vi.fn(regen)},
    });
    modules.chain.getHistoricalStateBySlot = vi.fn(BeaconChain.prototype.getHistoricalStateBySlot.bind(modules.chain));
    modules.chain.getStateByStateRoot = vi.fn().mockResolvedValue(null);
    modules.chain.getCanonicalBlockAtSlot = vi.fn(async (slot) => {
      const block = await archive.db.blockArchive.get(slot);
      return block ? {block, executionOptimistic: false, finalized: true} : null;
    });

    const create = stateTransition.createBeaconStateViewForHistoricalRegen;
    const watch = (state: stateTransition.IBeaconStateView) => {
      ownedStates.add(state);
      vi.spyOn(state, "release");
      const transition = state.stateTransition.bind(state);
      vi.spyOn(state, "stateTransition").mockImplementation((...args) => watch(transition(...args)));
      return state;
    };
    vi.spyOn(stateTransition, "createBeaconStateViewForHistoricalRegen").mockImplementation((opts) =>
      watch(create(opts))
    );
  });

  afterEach(() => {
    for (const state of ownedStates) {
      if (vi.mocked(state.release).mock.calls.length === 0) state.release();
    }
    ownedStates.clear();
    vi.restoreAllMocks();
  });

  function expectReleased() {
    expect(ownedStates.size).toBeGreaterThan(0);
    for (const [index, state] of [...ownedStates].entries()) {
      expect(state.release, `owned state ${index}`).toHaveBeenCalledExactlyOnceWith();
    }
  }

  async function expectTimings(transition: number, serialization: number) {
    for (const [name, count] of [
      ["lodestar_historical_state_regen_time_seconds", 1],
      ["lodestar_historical_state_load_nearest_state_time_seconds", 1],
      ["lodestar_historical_state_state_transition_time_seconds", transition],
      ["lodestar_historical_state_serialization_time_seconds", serialization],
    ] as const) {
      const lines = (await metricsRegister.getSingleMetricAsString(name)).split("\n");
      expect(lines, name).toContain(`${name}_count ${count}`);
    }
  }

  it.each(transitionSlots.filter((slot) => slot < transitionHeadSlot))(
    "reconstructs slot %i from an older Fulu state and archived blocks",
    async (slot) => {
      expect(await archive.db.stateArchive.getBinary(slot)).toBeNull();
      const expected = chain.stateAt(slot);
      const type = proofConfig.getForkTypes(slot).BeaconState;
      const gindex = type.getPathInfo(["validators", 4]).gindex;
      const {data, meta} = await api.getStateProof({stateId: String(slot), descriptor: computeDescriptor([gindex])});
      assert(!(data instanceof Uint8Array));
      const tree = Tree.createFromProof(data);
      expect(meta.version).toBe(proofConfig.getForkName(slot));
      expect(tree.root).toEqual(expected.hashTreeRoot());
      expect(tree.getNode(gindex).root).toEqual(ssz.phase0.Validator.hashTreeRoot(expected.getValidator(4)));
      const blockProof = await api.getBlockProof({blockId: String(slot), descriptor: computeDescriptor([11n])});
      assert(!(blockProof.data instanceof Uint8Array));
      expect(Tree.createFromProof(blockProof.data).getNode(11n).root).toEqual(expected.hashTreeRoot());
      expectReleased();
      await expectTimings(1, 1);
    }
  );

  it("loads a saved Gloas state directly without requiring earlier history", async () => {
    const saved = chain.stateAt(proofForkSlot + 1);
    await archive.db.stateArchive.batchDelete(await archive.db.stateArchive.keys());
    await archive.db.blockArchive.batchDeleteRange(await archive.db.blockArchive.keys());
    await archive.db.stateArchive.put(saved.slot, saved);
    const response = await api.getStateProof({stateId: String(saved.slot), descriptor: computeDescriptor([1n])});
    assert(!(response.data instanceof Uint8Array));
    expect(Tree.createFromProof(response.data).root).toEqual(saved.hashTreeRoot());
    expectReleased();
  });

  it("does not substitute historical slot reconstruction for an unavailable root lookup", async () => {
    const state = chain.stateAt(proofForkSlot);
    await expect(
      api.getStateProof({stateId: toHex(state.hashTreeRoot()), descriptor: computeDescriptor([1n])})
    ).rejects.toMatchObject({statusCode: 404});
    expect(modules.chain.getHistoricalStateBySlot).not.toHaveBeenCalled();
    const response = await api.getStateProof({stateId: String(state.slot), descriptor: computeDescriptor([1n])});
    assert(!(response.data instanceof Uint8Array));
    expect(Tree.createFromProof(response.data).root).toEqual(state.hashTreeRoot());
    expectReleased();
  });

  it("rejects historical proof requests when reconstruction is disabled", async () => {
    Object.assign(modules.chain.opts, {serveHistoricalState: false});
    await expect(
      api.getStateProof({stateId: String(proofForkSlot), descriptor: computeDescriptor([1n])})
    ).rejects.toMatchObject({statusCode: 404});
    expect(ownedStates.size).toBe(0);
  });

  it("rejects missing or pruned seed states", async () => {
    await archive.db.stateArchive.batchDelete(await archive.db.stateArchive.keys());
    await expect(
      api.getStateProof({stateId: String(proofForkSlot), descriptor: computeDescriptor([1n])})
    ).rejects.toMatchObject({statusCode: 404});
    expect(ownedStates.size).toBe(0);
    await expectTimings(0, 0);
  });

  it("rejects missing intervening blocks instead of returning a proof of another state", async () => {
    await archive.db.blockArchive.delete(proofForkSlot - 1);
    await expect(
      api.getStateProof({stateId: String(proofForkSlot + 1), descriptor: computeDescriptor([1n])})
    ).rejects.toMatchObject({statusCode: 404});
    expectReleased();
    await expectTimings(1, 0);
  });

  it("does not return the preceding block's state for an unretained skipped slot", async () => {
    await expect(
      api.getStateProof({stateId: String(proofForkSlot + 2), descriptor: computeDescriptor([1n])})
    ).rejects.toMatchObject({statusCode: 404});
    expectReleased();
    await expectTimings(1, 0);
  });

  it("serves a skipped slot when a state was saved at that exact slot", async () => {
    const saved = chain.stateAt(proofForkSlot + 1).processSlots(proofForkSlot + 2, {dontTransferCache: true});
    try {
      await archive.db.stateArchive.put(saved.slot, saved);
      expect(await archive.db.blockArchive.get(saved.slot)).toBeNull();
      const response = await api.getStateProof({stateId: String(saved.slot), descriptor: computeDescriptor([1n])});
      assert(!(response.data instanceof Uint8Array));
      expect(Tree.createFromProof(response.data).root).toEqual(saved.hashTreeRoot());
      expectReleased();
    } finally {
      saved.release();
    }
  });

  it("rejects a reconstructed state that does not match the archived block's state root", async () => {
    const block = proofConfig.getForkTypes(proofForkSlot - 1).SignedBeaconBlock.clone(chain.blockAt(proofForkSlot - 1));
    block.message.stateRoot[0] ^= 1;
    await archive.db.blockArchive.put(block.message.slot, block);
    await expect(
      api.getStateProof({stateId: String(block.message.slot), descriptor: computeDescriptor([1n])})
    ).rejects.toMatchObject({
      type: {
        code: RegenErrorCode.INVALID_STATE_ROOT,
        slot: block.message.slot,
        expected: toHex(block.message.stateRoot),
        actual: toHex(chain.stateAt(block.message.slot).hashTreeRoot()),
      },
    });
    expectReleased();
    await expectTimings(1, 0);
  });

  it("propagates archive database failures instead of treating them as missing data", async () => {
    const failure = Error("Archive database failed");
    vi.spyOn(archive.db.stateArchive, "binaries").mockRejectedValueOnce(failure);
    await expect(api.getStateProof({stateId: String(proofForkSlot), descriptor: computeDescriptor([1n])})).rejects.toBe(
      failure
    );
    expect(ownedStates.size).toBe(0);
    await expectTimings(0, 0);
  });

  it("propagates malformed archived state errors instead of returning 404", async () => {
    await archive.db.stateArchive.putBinary(chain.anchor.slot, Uint8Array.of(0));
    const error = await api
      .getStateProof({stateId: String(proofForkSlot), descriptor: computeDescriptor([1n])})
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toHaveProperty("statusCode");
    expect(ownedStates.size).toBe(0);
    await expectTimings(0, 0);
  });

  it("propagates an inconsistent retained parent instead of treating it as missing", async () => {
    const block = proofConfig.getForkTypes(proofForkSlot + 1).SignedBeaconBlock.clone(chain.blockAt(proofForkSlot + 1));
    const parent = chain.blockAt(proofForkSlot - 1);
    block.message.parentRoot = proofConfig.getForkTypes(parent.message.slot).BeaconBlock.hashTreeRoot(parent.message);
    await archive.db.blockArchive.put(block.message.slot, block);
    const error = await api
      .getStateProof({stateId: String(block.message.slot), descriptor: computeDescriptor([1n])})
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toHaveProperty("statusCode");
    expectReleased();
    await expectTimings(1, 0);
  });

  it("records timing and releases the state when serialization fails", async () => {
    const failure = Error("State serialization failed");
    const create = vi.mocked(stateTransition.createBeaconStateViewForHistoricalRegen).getMockImplementation();
    assert(create);
    vi.mocked(stateTransition.createBeaconStateViewForHistoricalRegen).mockImplementationOnce((opts) => {
      const state = create(opts);
      vi.spyOn(state, "serialize").mockImplementationOnce(() => {
        throw failure;
      });
      return state;
    });
    await expect(
      api.getStateProof({stateId: String(chain.anchor.slot), descriptor: computeDescriptor([1n])})
    ).rejects.toBe(failure);
    expectReleased();
    await expectTimings(1, 1);
  });
});
