import {beforeEach, describe, expect, it, vi} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {createBeaconConfig} from "@lodestar/config";
import {ExecutionStatus, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {Root, Slot, phase0, ssz} from "@lodestar/types";
import {defer, fromHex, toRootHex} from "@lodestar/utils";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {BeaconEngineEventBus} from "../../../../src/chain/beaconEngine/events.js";
import {BeaconEngine} from "../../../../src/chain/beaconEngine.js";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

const config = createBeaconConfig({}, new Uint8Array(32));

describe("BeaconEngine.getCanonicalBlockAtSlot", () => {
  let core: BeaconEngineCore;
  let engine: BeaconEngine;
  let block: phase0.SignedBeaconBlock;
  let bytes: Uint8Array;
  let canonical: ProtoBlock;
  const forkChoice = {
    getFinalizedBlock: vi.fn<() => ProtoBlock>(),
    getCanonicalBlockAtSlot: vi.fn<(slot: Slot) => ProtoBlock | null>(),
  };
  const getBinary = vi.fn<(root: Root) => Promise<Uint8Array | null>>();
  const getArchivedBinary = vi.fn<(slot: Slot) => Promise<Uint8Array | null>>();
  const getBinaryEntryByRoot = vi.fn<(root: Root) => Promise<{key: Slot; value: Uint8Array} | null>>();

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    block = ssz.phase0.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    const attestation = ssz.phase0.Attestation.defaultValue();
    attestation.aggregationBits = BitArray.fromBoolArray([true, false, true]);
    block.message.body.attestations.push(attestation);
    bytes = ssz.phase0.SignedBeaconBlock.serialize(block);
    canonical = generateProtoBlock({
      blockRoot: toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(ssz.phase0.BeaconBlock.clone(block.message))),
      slot: 1,
      executionStatus: ExecutionStatus.Syncing,
    });
    forkChoice.getFinalizedBlock.mockReturnValue(generateProtoBlock({slot: 0}));
    forkChoice.getCanonicalBlockAtSlot.mockImplementation(() => canonical);
    getBinary.mockImplementation(async () => bytes);
    getArchivedBinary.mockResolvedValue(null);
    getBinaryEntryByRoot.mockResolvedValue(null);
    core = Object.assign(Object.create(BeaconEngineCore.prototype) as BeaconEngineCore, {
      forkChoice,
      db: {block: {getBinary}, blockArchive: {getBinary: getArchivedBinary, getBinaryEntryByRoot}},
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

  it("returns canonical block bytes and execution metadata from Core", async () => {
    expect(await core.getCanonicalBlockAtSlot(1)).toEqual({
      block: bytes,
      slot: 1,
      executionOptimistic: true,
      finalized: false,
    });
    expect(getBinary).toHaveBeenCalledWith(fromHex(canonical.blockRoot));
    expect(getArchivedBinary).not.toHaveBeenCalled();
  });

  it("decodes the transported block in the facade without changing its bytes", async () => {
    const response = structuredClone(await core.getCanonicalBlockAtSlot(1));
    vi.spyOn(core, "getCanonicalBlockAtSlot").mockResolvedValue(response);
    const result = await engine.getCanonicalBlockAtSlot(1);
    expect(result).toEqual({block, executionOptimistic: true, finalized: false});
    expect(result?.block.message.body.attestations[0].aggregationBits.getTrueBitIndexes()).toEqual([0, 2]);
    expect(response?.block).toEqual(bytes);
  });

  it("uses execution status from the selected canonical payload variant", async () => {
    canonical = generateProtoBlock({
      blockRoot: canonical.blockRoot,
      slot: 1,
      payloadStatus: PayloadStatus.EMPTY,
      executionStatus: ExecutionStatus.Valid,
    });
    expect(await engine.getCanonicalBlockAtSlot(1)).toMatchObject({executionOptimistic: false});
  });

  it.each([1, 2])("reads the archive directly when the finalized block is at slot %s", async (finalizedSlot) => {
    forkChoice.getFinalizedBlock.mockReturnValue(generateProtoBlock({slot: finalizedSlot}));
    getArchivedBinary.mockResolvedValue(bytes);
    expect(await engine.getCanonicalBlockAtSlot(1)).toEqual({block, executionOptimistic: false, finalized: true});
    expect(getArchivedBinary).toHaveBeenCalledWith(1);
    expect(forkChoice.getCanonicalBlockAtSlot).not.toHaveBeenCalled();
    expect(getBinary).not.toHaveBeenCalled();
  });

  it("returns null for a skipped slot", async () => {
    forkChoice.getCanonicalBlockAtSlot.mockReturnValue(null);
    expect(await engine.getCanonicalBlockAtSlot(1)).toBeNull();
    expect(getBinary).not.toHaveBeenCalled();
  });

  it("reads the archived root when a canonical block leaves the hot database", async () => {
    getBinary.mockResolvedValue(null);
    getBinaryEntryByRoot.mockResolvedValue({key: 1, value: bytes});
    expect(await engine.getCanonicalBlockAtSlot(1)).toEqual({block, executionOptimistic: true, finalized: true});
    expect(getBinaryEntryByRoot).toHaveBeenCalledWith(fromHex(canonical.blockRoot));
    expect(getArchivedBinary).not.toHaveBeenCalled();
  });

  it("falls back to the archive by slot after the root read misses", async () => {
    getBinary.mockResolvedValue(null);
    getArchivedBinary.mockResolvedValue(bytes);
    expect(await engine.getCanonicalBlockAtSlot(1)).toEqual({block, executionOptimistic: false, finalized: true});
    expect(getArchivedBinary).toHaveBeenCalledWith(1);
  });

  it("returns null when canonical block data is unavailable", async () => {
    getBinary.mockResolvedValue(null);
    expect(await engine.getCanonicalBlockAtSlot(1)).toBeNull();
  });

  it("captures execution metadata before waiting for the block bytes", async () => {
    const pending = defer<Uint8Array | null>();
    getBinary.mockReturnValue(pending.promise);
    const result = engine.getCanonicalBlockAtSlot(1);
    canonical.executionStatus = ExecutionStatus.Valid;
    pending.resolve(bytes);
    expect(await result).toEqual({block, executionOptimistic: true, finalized: false});
  });
});
