import {beforeEach, describe, expect, it, vi} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {createBeaconConfig} from "@lodestar/config";
import {ExecutionStatus, ProtoBlock} from "@lodestar/fork-choice";
import {Root, Slot, phase0, ssz} from "@lodestar/types";
import {defer, toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {BeaconEngineEventBus} from "../../../../src/chain/beaconEngine/events.js";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

const config = createBeaconConfig({}, new Uint8Array(32));

describe("BeaconEngine.getBlockByRoot", () => {
  let core: BeaconEngineCore;
  let engine: BeaconEngine;
  let block: phase0.SignedBeaconBlock;
  let root: Root;
  let bytes: Uint8Array;
  let protoBlock: ProtoBlock;
  const forkChoice = {
    getBlockDefaultStatus: vi.fn<(root: Root) => ProtoBlock | null>(),
  };
  const getBinary = vi.fn<(root: Root) => Promise<Uint8Array | null>>();
  const getBinaryEntryByRoot = vi.fn<(root: Root) => Promise<{key: Slot; value: Uint8Array} | null>>();

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    block = ssz.phase0.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    const attestation = ssz.phase0.Attestation.defaultValue();
    attestation.aggregationBits = BitArray.fromBoolArray([true, false, true]);
    block.message.body.attestations.push(attestation);
    root = ssz.phase0.BeaconBlock.hashTreeRoot(ssz.phase0.BeaconBlock.clone(block.message));
    bytes = ssz.phase0.SignedBeaconBlock.serialize(block);
    protoBlock = generateProtoBlock({blockRoot: toRootHex(root), slot: 1, executionStatus: ExecutionStatus.Syncing});
    forkChoice.getBlockDefaultStatus.mockImplementation(() => protoBlock);
    getBinary.mockImplementation(async () => bytes);
    getBinaryEntryByRoot.mockResolvedValue(null);
    core = Object.assign(Object.create(BeaconEngineCore.prototype) as BeaconEngineCore, {
      forkChoice,
      db: {block: {getBinary}, blockArchive: {getBinaryEntryByRoot}},
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

  it("returns block bytes and metadata from Core using a byte root", async () => {
    expect(await core.getBlockByRoot(root)).toEqual({
      block: bytes,
      slot: 1,
      executionOptimistic: true,
      finalized: false,
    });
    expect(forkChoice.getBlockDefaultStatus).toHaveBeenCalledWith(root);
    expect(getBinary).toHaveBeenCalledWith(root);
    expect(getBinaryEntryByRoot).not.toHaveBeenCalled();
  });

  it("decodes the transported block in the facade without changing its bytes", async () => {
    const response = structuredClone(await core.getBlockByRoot(root));
    const getBlockByRoot = vi.spyOn(core, "getBlockByRoot").mockResolvedValue(response);
    const result = await engine.getBlockByRoot(root);
    expect(getBlockByRoot).toHaveBeenCalledWith(root);
    expect(result).toEqual({block, executionOptimistic: true, finalized: false});
    expect(result?.block.message.body.attestations[0].aggregationBits.getTrueBitIndexes()).toEqual([0, 2]);
    expect(response?.block).toEqual(bytes);
  });

  it("reads current execution status from the default payload variant", async () => {
    expect(await engine.getBlockByRoot(root)).toMatchObject({executionOptimistic: true});
    protoBlock.executionStatus = ExecutionStatus.Valid;
    expect(await engine.getBlockByRoot(root)).toMatchObject({executionOptimistic: false});
  });

  it.each([false, true])(
    "serves stored blocks after fork-choice metadata is pruned (archived=%s)",
    async (archived) => {
      forkChoice.getBlockDefaultStatus.mockReturnValue(null);
      if (archived) {
        getBinary.mockResolvedValue(null);
        getBinaryEntryByRoot.mockResolvedValue({key: 1, value: bytes});
      }
      expect(await engine.getBlockByRoot(root)).toEqual({block, executionOptimistic: false, finalized: archived});
    }
  );

  it("falls back to the archived root when the block leaves the hot database", async () => {
    getBinary.mockResolvedValue(null);
    getBinaryEntryByRoot.mockResolvedValue({key: 1, value: bytes});
    expect(await engine.getBlockByRoot(root)).toEqual({block, executionOptimistic: true, finalized: true});
    expect(getBinaryEntryByRoot).toHaveBeenCalledWith(root);
  });

  it("returns null when the block is unavailable", async () => {
    forkChoice.getBlockDefaultStatus.mockReturnValue(null);
    getBinary.mockResolvedValue(null);
    expect(await engine.getBlockByRoot(root)).toBeNull();
  });

  it("captures execution metadata before waiting for the block bytes", async () => {
    const pending = defer<Uint8Array | null>();
    getBinary.mockReturnValue(pending.promise);
    const result = engine.getBlockByRoot(root);
    protoBlock.executionStatus = ExecutionStatus.Valid;
    pending.resolve(bytes);
    expect(await result).toEqual({block, executionOptimistic: true, finalized: false});
  });
});
