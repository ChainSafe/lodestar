import {beforeEach, describe, expect, it, vi} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {ExecutionStatus, IForkChoice, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {Root, SignedBeaconBlock, Slot, phase0, ssz} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {BeaconEngineEventBus} from "../../../../src/chain/beaconEngine/events.js";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

const config = createBeaconConfig({}, new Uint8Array(32));
const parentRoot = new Uint8Array(32).fill(1);

describe("BeaconEngine.getBlockHeaders", () => {
  let core: BeaconEngineCore;
  let engine: BeaconEngine;
  let block: phase0.SignedBeaconBlock;
  let canonical: ProtoBlock;
  let sibling: ProtoBlock;
  const blocks = new Map<string, Uint8Array>();
  const forkChoice = {
    getHead: vi.fn<IForkChoice["getHead"]>(),
    getFinalizedBlock: vi.fn<IForkChoice["getFinalizedBlock"]>(),
    getCanonicalBlockAtSlot: vi.fn<IForkChoice["getCanonicalBlockAtSlot"]>(),
    getBlockDefaultStatus: vi.fn<IForkChoice["getBlockDefaultStatus"]>(),
    getBlockSummariesAtSlot: vi.fn<IForkChoice["getBlockSummariesAtSlot"]>(),
    getBlockSummariesByParentRoot: vi.fn<IForkChoice["getBlockSummariesByParentRoot"]>(),
  };
  const getBinary = vi.fn<(root: Root) => Promise<Uint8Array | null>>();
  const getArchivedBinary = vi.fn<(slot: Slot) => Promise<Uint8Array | null>>();
  const getBinaryEntryByRoot = vi.fn<(root: Root) => Promise<{key: Slot; value: Uint8Array} | null>>();
  const getByParentRoot = vi.fn<(root: Root) => Promise<SignedBeaconBlock | null>>();

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    blocks.clear();
    block = ssz.phase0.SignedBeaconBlock.defaultValue();
    block.message.slot = 2;
    block.message.parentRoot = parentRoot;
    const attestation = ssz.phase0.Attestation.defaultValue();
    attestation.aggregationBits = BitArray.fromBoolArray([true, false, true]);
    block.message.body.attestations.push(attestation);
    const siblingBlock = ssz.phase0.SignedBeaconBlock.clone(block);
    siblingBlock.message.proposerIndex = 1;
    canonical = generateProtoBlock({
      blockRoot: toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(ssz.phase0.BeaconBlock.clone(block.message))),
      parentRoot: toRootHex(parentRoot),
      slot: 2,
      executionStatus: ExecutionStatus.Syncing,
    });
    sibling = generateProtoBlock({
      blockRoot: toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(siblingBlock.message)),
      parentRoot: toRootHex(parentRoot),
      slot: 2,
      executionStatus: ExecutionStatus.Valid,
    });
    blocks.set(canonical.blockRoot, ssz.phase0.SignedBeaconBlock.serialize(block));
    blocks.set(sibling.blockRoot, ssz.phase0.SignedBeaconBlock.serialize(siblingBlock));
    forkChoice.getHead.mockImplementation(() => canonical);
    forkChoice.getFinalizedBlock.mockReturnValue(generateProtoBlock({slot: 1}));
    forkChoice.getCanonicalBlockAtSlot.mockImplementation((slot) => (slot === 2 ? canonical : null));
    forkChoice.getBlockDefaultStatus.mockImplementation(
      (root) => [canonical, sibling].find((summary) => summary.blockRoot === toRootHex(root)) ?? null
    );
    forkChoice.getBlockSummariesAtSlot.mockImplementation((slot) => (slot === 2 ? [canonical, sibling] : []));
    forkChoice.getBlockSummariesByParentRoot.mockReturnValue([]);
    getBinary.mockImplementation(async (root) => blocks.get(toRootHex(root)) ?? null);
    getArchivedBinary.mockResolvedValue(null);
    getBinaryEntryByRoot.mockResolvedValue(null);
    getByParentRoot.mockResolvedValue(null);
    core = Object.assign(Object.create(BeaconEngineCore.prototype) as BeaconEngineCore, {
      config,
      forkChoice,
      db: {block: {getBinary}, blockArchive: {getBinary: getArchivedBinary, getBinaryEntryByRoot, getByParentRoot}},
      emitter: new BeaconEngineEventBus(),
    });
    engine = new BeaconEngine({
      core,
      config,
      emitter: new ChainEventEmitter(),
      clock: new ClockStopped(0),
      serializedCache: new SerializedCache(),
    });
  });

  it("defaults to the engine head slot and returns canonical and fork headers", async () => {
    const response = await engine.getBlockHeaders({});
    expect(response.data.map(({root, canonical}) => ({root: toRootHex(root), canonical}))).toEqual([
      {root: canonical.blockRoot, canonical: true},
      {root: sibling.blockRoot, canonical: false},
    ]);
    expect(response.meta).toEqual({executionOptimistic: true, finalized: false});
    expect(forkChoice.getBlockSummariesAtSlot).toHaveBeenCalledWith(2);
    expect(response.data[0].header.message).toMatchObject({slot: 2, parentRoot});
    expect(toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(response.data[0].header.message))).toBe(
      canonical.blockRoot
    );
  });

  it("transports serialized headers and preserves stored block bytes", async () => {
    const before = new Map([...blocks].map(([root, bytes]) => [root, bytes.slice()]));
    const response = structuredClone(await core.getBlockHeaders({slot: 2}));
    expect(response.data).toBeInstanceOf(Uint8Array);
    const getBlockHeaders = vi.spyOn(core, "getBlockHeaders").mockResolvedValue(response);
    const decoded = await engine.getBlockHeaders({slot: 2});
    expect(getBlockHeaders).toHaveBeenCalledWith({slot: 2});
    expect(routes.beacon.block.BlockHeadersResponseType.serialize(decoded.data)).toEqual(response.data);
    expect(decoded.meta).toEqual(response.meta);
    expect(blocks).toEqual(before);
  });

  it.each([1, 3])("returns empty non-finalized metadata for a skipped or future slot %s", async (slot) => {
    expect(await engine.getBlockHeaders({slot})).toEqual({
      data: [],
      meta: {executionOptimistic: false, finalized: false},
    });
    expect(getBinary).not.toHaveBeenCalled();
  });

  it("serves a finalized slot from the archive", async () => {
    const archived = ssz.phase0.SignedBeaconBlock.defaultValue();
    archived.message.slot = 1;
    getArchivedBinary.mockResolvedValue(ssz.phase0.SignedBeaconBlock.serialize(archived));
    const response = await engine.getBlockHeaders({slot: 1});
    expect(response.data).toHaveLength(1);
    expect(response.data[0]).toMatchObject({canonical: true, header: {message: {slot: 1}}});
    expect(response.meta).toEqual({executionOptimistic: false, finalized: true});
  });

  it("uses every summary's payload variant for slot optimism without duplicating the canonical header", async () => {
    canonical.payloadStatus = PayloadStatus.PENDING;
    canonical.executionStatus = ExecutionStatus.Valid;
    const full = generateProtoBlock({
      blockRoot: canonical.blockRoot,
      slot: canonical.slot,
      payloadStatus: PayloadStatus.FULL,
      executionStatus: ExecutionStatus.Syncing,
    });
    forkChoice.getBlockSummariesAtSlot.mockReturnValue([canonical, full]);
    const response = await engine.getBlockHeaders({slot: 2});
    expect(response.data).toHaveLength(1);
    expect(response.meta).toEqual({executionOptimistic: true, finalized: false});
  });

  it("retains summary metadata when a fork block is unavailable", async () => {
    canonical.executionStatus = ExecutionStatus.Valid;
    sibling.executionStatus = ExecutionStatus.Syncing;
    blocks.delete(sibling.blockRoot);
    const response = await engine.getBlockHeaders({slot: 2});
    expect(response.data).toHaveLength(1);
    expect(response.meta).toEqual({executionOptimistic: true, finalized: false});
  });

  it("uses the canonical variant's optimism for the parent-root query", async () => {
    forkChoice.getBlockSummariesByParentRoot.mockReturnValue([sibling]);
    const response = await engine.getBlockHeaders({parentRoot});
    expect(response.data).toHaveLength(1);
    expect(response.data[0]).toMatchObject({root: fromHex(sibling.blockRoot), canonical: false});
    expect(response.meta).toEqual({executionOptimistic: true, finalized: false});
    expect(getByParentRoot).toHaveBeenCalledWith(parentRoot);
    expect(forkChoice.getBlockSummariesByParentRoot).toHaveBeenCalledWith(toRootHex(parentRoot));

    canonical.executionStatus = ExecutionStatus.Valid;
    sibling.executionStatus = ExecutionStatus.Syncing;
    expect((await engine.getBlockHeaders({parentRoot})).meta.executionOptimistic).toBe(false);
  });

  it.each([undefined, 0, 1, 2])("preserves parent-root filtering with slot %s", async (slot) => {
    const archived = ssz.phase0.SignedBeaconBlock.defaultValue();
    archived.message.slot = 1;
    getByParentRoot.mockResolvedValue(archived);
    forkChoice.getBlockSummariesByParentRoot.mockReturnValue([canonical, sibling]);
    const response = await engine.getBlockHeaders({slot, parentRoot});
    expect(response.data.map(({header}) => header.message.slot)).toEqual(
      slot === 1 ? [1] : slot === 2 ? [2, 2] : [1, 2, 2]
    );
    expect(response.meta).toEqual({executionOptimistic: true, finalized: false});
  });

  it("returns finalized metadata when only an archived child matches the parent", async () => {
    getByParentRoot.mockResolvedValue(ssz.phase0.SignedBeaconBlock.defaultValue());
    const response = await engine.getBlockHeaders({parentRoot});
    expect(response.data).toHaveLength(1);
    expect(response.data[0].canonical).toBe(true);
    expect(response.meta).toEqual({executionOptimistic: false, finalized: true});
  });

  it("skips parent-root candidates without a canonical block at their slot", async () => {
    forkChoice.getBlockSummariesByParentRoot.mockReturnValue([sibling]);
    forkChoice.getCanonicalBlockAtSlot.mockReturnValue(null);
    expect(await engine.getBlockHeaders({parentRoot})).toEqual({
      data: [],
      meta: {executionOptimistic: false, finalized: true},
    });
  });

  it("retains root archive fallback while constructing headers", async () => {
    forkChoice.getBlockSummariesByParentRoot.mockReturnValue([sibling]);
    const bytes = blocks.get(sibling.blockRoot);
    if (!bytes) throw Error("Missing sibling block fixture");
    getBinary.mockResolvedValue(null);
    getBinaryEntryByRoot.mockResolvedValue({key: 2, value: bytes});
    const response = await engine.getBlockHeaders({parentRoot});
    expect(response.data[0].root).toEqual(fromHex(sibling.blockRoot));
    expect(response.meta).toEqual({executionOptimistic: true, finalized: false});
  });
});
