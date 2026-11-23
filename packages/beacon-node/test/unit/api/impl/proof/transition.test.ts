import {fastify} from "fastify";
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {ProofType, Tree, computeDescriptor, concatGindices} from "@chainsafe/persistent-merkle-tree";
import {ContainerType} from "@chainsafe/ssz";
import {WireFormat, getClient, routes} from "@lodestar/api";
import {createFastifyRoutes} from "@lodestar/api/server";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {IBeaconStateView, computeTimeAtSlot} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {byteArrayEquals, toHex} from "@lodestar/utils";
import {getProofApi} from "../../../../../src/api/impl/proof/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {SyncState} from "../../../../../src/sync/index.js";
import {getApiTestModules} from "../../../../utils/api.js";
import {generateProtoBlock} from "../../../../utils/typeGenerator.js";
import {proofConfig, proofForkSlot} from "./fixtures.js";
import {
  createTransitionBlock,
  createTransitionChain,
  transitionHeadSlot,
  transitionOptions,
  transitionSlots,
} from "./transitionFixtures.js";

const backends = process.env.LODESTAR_NATIVE_STATE_TRANSITION === "true" ? [false, true] : [false];
const validatorType = new ContainerType(ssz.phase0.Validator.fields);
const boundarySlots = [proofForkSlot - 1, proofForkSlot, proofForkSlot + 1];
const headSlots = [...boundarySlots, transitionHeadSlot];

describe.each(backends)("proofs from transitioned states (native=%s)", (native) => {
  const modules = getApiTestModules({config: proofConfig});
  const server = fastify();
  let client: ReturnType<typeof getClient>;
  let chain: ReturnType<typeof createTransitionChain>;
  let reference: ReturnType<typeof createTransitionChain>;

  beforeAll(async () => {
    reference = createTransitionChain(false);
    chain = native ? createTransitionChain(true) : reference;
    for (const [slot, state] of chain.states) {
      expect(byteArrayEquals(state.serialize(), reference.stateAt(slot).serialize()), `backend parity at ${slot}`).toBe(
        true
      );
    }
    const definitions = createFastifyRoutes(
      routes.proof.getDefinitions(proofConfig),
      getProofApi(defaultApiOptions, modules)
    );
    server.route(definitions.getStateProof);
    server.route(definitions.getBlockProof);
    client = getClient({baseUrl: await server.listen({port: 0, host: "127.0.0.1"})}, {config: proofConfig});
  });

  afterAll(async () => {
    await server.close();
    if (chain !== reference) chain?.close();
    reference?.close();
  });

  beforeEach(() => {
    modules.chain.getStateByStateRoot = vi.fn(async (root) => {
      const state = [...chain.states.values()].find((state) => toHex(state.hashTreeRoot()) === root);
      return state ? {state, executionOptimistic: false, finalized: false} : null;
    });
    modules.chain.getStateBySlot = vi.fn(async (slot) => {
      const state = chain.states.get(slot);
      return state ? {state, executionOptimistic: false, finalized: false} : null;
    });
    modules.chain.getHistoricalStateBySlot = vi.fn(async (slot) => {
      const state = chain.states.get(slot);
      return state ? {state: state.serialize(), executionOptimistic: false, finalized: true} : null;
    });
    modules.chain.getCanonicalBlockAtSlot = vi.fn(async (slot) => {
      const block = chain.blocks.get(slot);
      return block ? {block, executionOptimistic: false, finalized: false} : null;
    });
    modules.chain.getBlockByRoot.mockImplementation(async (root) => {
      const block = [...chain.blocks.values()].find(
        (block) => toHex(proofConfig.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message)) === root
      );
      return block ? {block, executionOptimistic: false, finalized: false} : null;
    });
    modules.chain.regen.getStateSync.mockImplementation(
      (root) => [...chain.states.values()].find((state) => toHex(state.hashTreeRoot()) === root) ?? null
    );
    modules.chain.getStateOrBytesByCheckpoint = vi.fn(async ({epoch}) => {
      const state = chain.states.get(epoch * SLOTS_PER_EPOCH);
      return state ? {state: state.serialize(), executionOptimistic: false, finalized: true} : null;
    });
    Object.defineProperty(modules.sync, "state", {value: SyncState.Synced});
    setHead(transitionHeadSlot);
  });

  function setHead(slot: number, historical = false) {
    const state = chain.stateAt(slot);
    const block = chain.blockAt(slot);
    const root = proofConfig.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message);
    const proto = generateProtoBlock({slot, stateRoot: toHex(state.hashTreeRoot()), blockRoot: toHex(root)});
    modules.chain.getHeadState.mockReturnValue(state);
    modules.forkChoice.getHead.mockReturnValue(proto);
    modules.forkChoice.getFinalizedBlock.mockReturnValue(historical ? proto : generateProtoBlock({slot: 0}));
    modules.forkChoice.getFinalizedCheckpoint.mockReturnValue({epoch: 2, root, rootHex: toHex(root)});
    modules.forkChoice.getJustifiedCheckpoint = vi.fn().mockReturnValue({epoch: 2, root, rootHex: toHex(root)});
    modules.forkChoice.getJustifiedBlock = vi.fn().mockReturnValue(proto);
    Object.defineProperty(modules.chain.clock, "currentSlot", {value: slot});
  }

  async function expectStateProof(stateId: string, state: IBeaconStateView) {
    const type = proofConfig.getForkTypes(state.slot).BeaconState;
    const expected = type.deserialize(reference.stateAt(state.slot).serialize());
    const validatorIndex = type.getPathInfo(["validators", 4]).gindex;
    const credentialsIndex = concatGindices([
      validatorIndex,
      validatorType.getPathInfo(["withdrawalCredentials"]).gindex,
    ]);
    const balanceIndex = type.getPathInfo(["balances", 4]).gindex;
    const lengthIndex = concatGindices([type.getPathInfo(["validators"]).gindex, 3n]);
    const slotIndex = type.getPathInfo(["slot"]).gindex;
    const descriptor = computeDescriptor([validatorIndex, credentialsIndex, balanceIndex, lengthIndex, slotIndex]);
    for (const format of [WireFormat.json, WireFormat.ssz]) {
      const response = await client.proof.getStateProof({stateId, descriptor}, {responseWireFormat: format});
      expect(response.meta().version).toBe(proofConfig.getForkName(state.slot));
      const tree = Tree.createFromProof(response.value());
      expect(tree.root).toEqual(type.hashTreeRoot(expected));
      expect(tree.getNode(validatorIndex).root).toEqual(ssz.phase0.Validator.hashTreeRoot(expected.validators[4]));
      expect(tree.getNode(credentialsIndex).root).toEqual(expected.validators[4].withdrawalCredentials);
      expect(tree.getNode(slotIndex).root).toEqual(ssz.Slot.hashTreeRoot(state.slot));
      expect(tree.getNode(lengthIndex).root).toEqual(ssz.UintNum64.hashTreeRoot(expected.validators.length));
      const chunk = tree.getNode(balanceIndex).root;
      expect(new DataView(chunk.buffer, chunk.byteOffset).getBigUint64(0, true)).toBe(BigInt(expected.balances[4]));
      expect(Tree.createFromProof(tree.getProof({type: ProofType.single, gindex: credentialsIndex})).root).toEqual(
        state.hashTreeRoot()
      );
    }
  }

  for (const headSlot of headSlots) {
    for (const slot of transitionSlots.filter((slot) => slot <= headSlot)) {
      for (const lookup of ["root", "slot", "historical"] as const) {
        if (lookup === "historical" && slot >= headSlot) continue;
        it(`proves state ${slot} by ${lookup} with head at ${headSlot}`, async () => {
          setHead(headSlot, lookup === "historical");
          const state = chain.stateAt(slot);
          const id = lookup === "root" ? toHex(state.hashTreeRoot()) : String(slot);
          await expectStateProof(id, state);
          if (lookup === "historical") expect(modules.chain.getHistoricalStateBySlot).toHaveBeenCalledWith(slot);
          else if (lookup === "slot")
            expect(modules.chain.getStateBySlot).toHaveBeenCalledWith(slot, {allowRegen: true});
          else expect(modules.chain.getStateByStateRoot).toHaveBeenCalledWith(id, {allowRegen: true});
        });
      }
    }
  }

  it.each(transitionSlots)("proves transitioned block %i by root and slot", async (slot) => {
    const block = chain.blockAt(slot);
    const type = proofConfig.getForkTypes(slot).BeaconBlock;
    const root = type.hashTreeRoot(block.message);
    const gindex = type.getPathInfo(["stateRoot"]).gindex;
    for (const blockId of [toHex(root), String(slot)]) {
      for (const format of [WireFormat.json, WireFormat.ssz]) {
        const response = await client.proof.getBlockProof(
          {blockId, descriptor: computeDescriptor([gindex])},
          {responseWireFormat: format}
        );
        expect(response.meta().version, `${blockId} (${format})`).toBe(proofConfig.getForkName(slot));
        const tree = Tree.createFromProof(response.value());
        expect(tree.root, `${blockId} (${format})`).toEqual(root);
        expect(tree.getNode(gindex).root, `${blockId} (${format})`).toEqual(reference.stateAt(slot).hashTreeRoot());
      }
    }
  });

  it.each(["head", "finalized", "justified", "genesis"])("resolves the %s state and block aliases", async (id) => {
    setHead(proofForkSlot, true);
    const state = chain.stateAt(id === "genesis" ? 0 : proofForkSlot);
    await expectStateProof(id, state);
    const response = await client.proof.getBlockProof({blockId: id, descriptor: computeDescriptor([11n])});
    expect(response.meta().version).toBe(proofConfig.getForkName(state.slot));
    expect(Tree.createFromProof(response.value()).getNode(11n).root).toEqual(state.hashTreeRoot());
  });

  it("keeps a pinned state root stable when head advances", async () => {
    const descriptor = computeDescriptor([1n]);
    setHead(proofForkSlot);
    const before = await client.proof.getStateProof({stateId: "head", descriptor});
    const pinnedRoot = Tree.createFromProof(before.value()).root;
    setHead(proofForkSlot + 1);
    const after = await client.proof.getStateProof({stateId: "head", descriptor});
    expect(Tree.createFromProof(after.value()).root).not.toEqual(pinnedRoot);
    const pinned = await client.proof.getStateProof({stateId: toHex(pinnedRoot), descriptor});
    expect(Tree.createFromProof(pinned.value()).root).toEqual(pinnedRoot);
  });

  it.each(["finalized", "justified"])("keeps a pinned root stable when the %s checkpoint changes", async (id) => {
    setHead(0, true);
    const genesisRoot = proofConfig.getForkTypes(0).BeaconBlock.hashTreeRoot(chain.blockAt(0).message);
    const checkpoint = {epoch: 0, root: genesisRoot, rootHex: toHex(genesisRoot)};
    modules.forkChoice.getFinalizedCheckpoint.mockReturnValue(checkpoint);
    modules.forkChoice.getJustifiedCheckpoint.mockReturnValue(checkpoint);
    const descriptor = computeDescriptor([1n]);
    const before = await client.proof.getStateProof({stateId: id, descriptor});
    const pinnedRoot = Tree.createFromProof(before.value()).root;
    expect(pinnedRoot).toEqual(chain.stateAt(0).hashTreeRoot());
    setHead(proofForkSlot, true);
    const after = await client.proof.getStateProof({stateId: id, descriptor});
    expect(Tree.createFromProof(after.value()).root).toEqual(chain.stateAt(proofForkSlot).hashTreeRoot());
    expect(Tree.createFromProof(after.value()).root).not.toEqual(pinnedRoot);
    const pinned = await client.proof.getStateProof({stateId: toHex(pinnedRoot), descriptor});
    expect(Tree.createFromProof(pinned.value()).root).toEqual(pinnedRoot);
  });

  it("keeps a pinned state root stable across a same-slot reorganization", async () => {
    const slot = proofForkSlot + 1;
    const parent = chain.stateAt(proofForkSlot);
    const alternate = createTransitionBlock(parent, slot, new Uint8Array(32).fill(1));
    try {
      const verified = parent.stateTransition({block: alternate.block}, transitionOptions, {});
      verified.release();
      setHead(slot);
      const descriptor = computeDescriptor([1n]);
      const before = await client.proof.getStateProof({stateId: "head", descriptor});
      const pinnedRoot = Tree.createFromProof(before.value()).root;
      const alternateRoot = alternate.postState.hashTreeRoot();
      modules.forkChoice.getHead.mockReturnValue(
        generateProtoBlock({
          slot,
          stateRoot: toHex(alternateRoot),
          blockRoot: toHex(proofConfig.getForkTypes(slot).BeaconBlock.hashTreeRoot(alternate.block.message)),
        })
      );
      modules.chain.regen.getStateSync.mockReturnValue(alternate.postState);
      modules.chain.getHeadState.mockReturnValue(alternate.postState);
      const after = await client.proof.getStateProof({stateId: "head", descriptor});
      expect(Tree.createFromProof(after.value()).root).toEqual(alternateRoot);
      expect(alternateRoot).not.toEqual(pinnedRoot);
      const pinned = await client.proof.getStateProof({stateId: toHex(pinnedRoot), descriptor});
      expect(Tree.createFromProof(pinned.value()).root).toEqual(pinnedRoot);
    } finally {
      alternate.postState.release();
    }
  });

  it("keeps a skipped-slot state distinct from the parent block's post-state", async () => {
    const parent = chain.stateAt(proofForkSlot + 1);
    const skipped = parent.processSlots(proofForkSlot + 2, {dontTransferCache: true});
    try {
      modules.chain.getStateBySlot.mockResolvedValueOnce({
        state: skipped,
        executionOptimistic: false,
        finalized: false,
      });
      const response = await client.proof.getStateProof({
        stateId: String(skipped.slot),
        descriptor: computeDescriptor([1n]),
      });
      expect(Tree.createFromProof(response.value()).root).toEqual(skipped.hashTreeRoot());
      expect(skipped.hashTreeRoot()).not.toEqual(parent.hashTreeRoot());
      expect(ssz.phase0.BeaconBlockHeader.hashTreeRoot(skipped.latestBlockHeader)).toEqual(
        proofConfig.getForkTypes(parent.slot).BeaconBlock.hashTreeRoot(chain.blockAt(parent.slot).message)
      );
      const child = chain.blockAt(proofForkSlot + 3);
      expect(child.message.parentRoot).toEqual(ssz.phase0.BeaconBlockHeader.hashTreeRoot(skipped.latestBlockHeader));
      expect(skipped.latestBlockHeader.slot).toBe(parent.slot);
      expect(child.message.slot - 1).not.toBe(skipped.latestBlockHeader.slot);
      const blockType = proofConfig.getForkTypes(parent.slot).BeaconBlock;
      const slotIndex = blockType.getPathInfo(["slot"]).gindex;
      const stateRootIndex = blockType.getPathInfo(["stateRoot"]).gindex;
      // EIP-4788 associates the execution timestamp with the parent beacon root, not the child state.
      const timestamp = computeTimeAtSlot(proofConfig, child.message.slot, parent.genesisTime);
      const parentProof = await client.proof.getBlockProof({
        blockId: toHex(child.message.parentRoot),
        descriptor: computeDescriptor([slotIndex, stateRootIndex]),
      });
      const parentTree = Tree.createFromProof(parentProof.value());
      expect(parentTree.root).toEqual(child.message.parentRoot);
      const slotChunk = parentTree.getNode(slotIndex).root;
      const provenSlot = new DataView(slotChunk.buffer, slotChunk.byteOffset).getBigUint64(0, true);
      expect(provenSlot).toBe(BigInt(parent.slot));
      expect(timestamp).not.toBe(computeTimeAtSlot(proofConfig, Number(provenSlot) + 1, parent.genesisTime));
      const stateProof = await client.proof.getStateProof({
        stateId: String(provenSlot),
        descriptor: computeDescriptor([1n]),
      });
      expect(Tree.createFromProof(stateProof.value()).root).toEqual(parentTree.getNode(stateRootIndex).root);
      expect(Tree.createFromProof(response.value()).root).not.toEqual(parentTree.getNode(stateRootIndex).root);
      const absent = await client.proof.getBlockProof({
        blockId: String(skipped.slot),
        descriptor: computeDescriptor([1n]),
      });
      expect(absent.status).toBe(404);
    } finally {
      skipped.release();
    }
  });

  it("upgrades through a skipped activation slot before proving the next block's state", async () => {
    const parent = chain.stateAt(proofForkSlot - 1);
    const skippedActivation = createTransitionBlock(parent, proofForkSlot + 1);
    try {
      const verified = parent.stateTransition({block: skippedActivation.block}, transitionOptions, {});
      verified.release();
      const state = skippedActivation.postState;
      expect(state.forkName).toBe("gloas");
      expect(state.fork.epoch).toBe(2);
      expect(state.getValidator(4)).toEqual(parent.getValidator(4));
      const parentRoot = proofConfig
        .getForkTypes(parent.slot)
        .BeaconBlock.hashTreeRoot(chain.blockAt(parent.slot).message);
      expect(skippedActivation.block.message.parentRoot).toEqual(parentRoot);
      modules.chain.getStateBySlot.mockResolvedValue({state, executionOptimistic: false, finalized: false});
      const type = ssz.gloas.BeaconState;
      const gindex = type.getPathInfo(["validators", 4]).gindex;
      for (const format of [WireFormat.json, WireFormat.ssz]) {
        const response = await client.proof.getStateProof(
          {stateId: String(state.slot), descriptor: computeDescriptor([gindex])},
          {responseWireFormat: format}
        );
        const tree = Tree.createFromProof(response.value());
        expect(response.meta().version, format).toBe("gloas");
        expect(tree.root, format).toEqual(skippedActivation.block.message.stateRoot);
        expect(tree.getNode(gindex).root, format).toEqual(ssz.phase0.Validator.hashTreeRoot(parent.getValidator(4)));
      }
    } finally {
      skippedActivation.postState.release();
    }
  });

  it("identifies the skipped-slot head fallback by its own state root", async () => {
    const parent = chain.stateAt(proofForkSlot + 1);
    const skipped = parent.processSlots(proofForkSlot + 2, {dontTransferCache: true});
    try {
      setHead(parent.slot);
      Object.defineProperty(modules.chain.clock, "currentSlot", {value: skipped.slot});
      modules.chain.regen.getStateSync.mockReturnValue(null);
      modules.chain.getHeadState.mockReturnValue(skipped);
      const response = await client.proof.getStateProof({stateId: "head", descriptor: computeDescriptor([1n])});
      const root = Tree.createFromProof(response.value()).root;
      expect(root).toEqual(skipped.hashTreeRoot());
      expect(root).not.toEqual(chain.blockAt(parent.slot).message.stateRoot);
    } finally {
      skipped.release();
    }
  });

  it("rejects future slots before attempting state retrieval", async () => {
    setHead(proofForkSlot - 1);
    const response = await client.proof.getStateProof({
      stateId: String(proofForkSlot),
      descriptor: computeDescriptor([1n]),
    });
    expect(response.status).toBe(404);
    expect(modules.chain.getStateBySlot).not.toHaveBeenCalled();
    expect(modules.chain.getHistoricalStateBySlot).not.toHaveBeenCalled();
  });

  it("preserves validator records while the upgrade changes their generalized indices", () => {
    const before = chain.stateAt(proofForkSlot - 1);
    const after = chain.stateAt(proofForkSlot);
    expect(before.forkName).toBe("fulu");
    expect(after.forkName).toBe("gloas");
    expect(after.fork.previousVersion).toEqual(proofConfig.FULU_FORK_VERSION);
    expect(after.fork.currentVersion).toEqual(proofConfig.GLOAS_FORK_VERSION);
    expect(after.fork.epoch).toBe(2);
    expect(after.getValidator(4)).toEqual(before.getValidator(4));
    expect(ssz.fulu.BeaconState.getPathInfo(["validators", 4]).gindex).not.toBe(
      ssz.gloas.BeaconState.getPathInfo(["validators", 4]).gindex
    );
  });
});
