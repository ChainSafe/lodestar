import {beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {ExecutionStatus, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {Root, Slot, altair, ssz} from "@lodestar/types";
import {defer, fromHex, toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {BeaconEngineEventBus} from "../../../../src/chain/beaconEngine/events.js";
import {BeaconEngineErrorCode} from "../../../../src/chain/beaconEngine/interface.js";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {RegenCaller} from "../../../../src/chain/regen/index.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

const root = (n: number) => toRootHex(Buffer.alloc(32, n));
const config = createBeaconConfig(
  {
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: 0,
  },
  Buffer.alloc(32)
);

describe("BeaconEngine validator data", () => {
  let core: BeaconEngineCore;
  let engine: BeaconEngine;
  let head: ProtoBlock;
  const source = {epoch: 0, root: new Uint8Array(32).fill(3)};
  const forkChoice = {
    getHead: vi.fn<() => ProtoBlock>(),
    getCanonicalBlockByRoot: vi.fn<(root: Root) => ProtoBlock | null>(),
    getCanonicalBlockClosestLteSlot: vi.fn<(slot: Slot) => ProtoBlock | null>(),
    getCanonicalBlockAtSlot: vi.fn<(slot: Slot) => ProtoBlock | null>(),
    getBlockDefaultStatus: vi.fn<(root: Root) => ProtoBlock | null>(),
  };
  const regen = {
    getClosestHeadState: vi.fn<() => IBeaconStateView>(),
    getBlockSlotState: vi.fn<() => Promise<IBeaconStateView>>(),
  };
  const getContribution = vi.fn<() => altair.SyncCommitteeContribution | null>();

  beforeEach(() => {
    vi.resetAllMocks();
    head = generateProtoBlock({blockRoot: root(1), slot: SLOTS_PER_EPOCH, executionStatus: ExecutionStatus.Valid});
    forkChoice.getHead.mockImplementation(() => head);
    forkChoice.getCanonicalBlockByRoot.mockImplementation(() => head);
    forkChoice.getCanonicalBlockClosestLteSlot.mockImplementation(() => head);
    forkChoice.getCanonicalBlockAtSlot.mockImplementation(() => head);
    forkChoice.getBlockDefaultStatus.mockImplementation(() => head);
    regen.getClosestHeadState.mockImplementation(
      () => ({slot: head.slot, currentJustifiedCheckpoint: source}) as IBeaconStateView
    );
    core = Object.assign(Object.create(BeaconEngineCore.prototype) as BeaconEngineCore, {
      config,
      forkChoice,
      regen,
      syncCommitteeMessagePool: {getContribution},
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

  it.each([
    [PayloadStatus.FULL, 0, 0],
    [PayloadStatus.FULL, 1, 1],
    [PayloadStatus.EMPTY, 1, 0],
    [PayloadStatus.PENDING, 1, 0],
  ])("uses the canonical payload variant %s at slot offset %s", async (payloadStatus, offset, index) => {
    head = {...head, payloadStatus};
    const result = await engine.produceAttestationData(head.slot + offset);
    expect(result).toEqual({
      ok: true,
      data: {
        slot: head.slot + offset,
        index,
        beaconBlockRoot: fromHex(head.blockRoot),
        source,
        target: {epoch: 1, root: fromHex(head.blockRoot)},
      },
    });
  });

  it("selects the closest canonical blocks for a past attestation and skipped epoch boundary", async () => {
    head = {...head, slot: SLOTS_PER_EPOCH + 5};
    const attested = {...head, blockRoot: root(2), slot: SLOTS_PER_EPOCH + 2};
    const target = {...head, blockRoot: root(4), slot: SLOTS_PER_EPOCH - 1};
    forkChoice.getCanonicalBlockClosestLteSlot.mockImplementation((slot) =>
      slot === SLOTS_PER_EPOCH ? target : attested
    );
    forkChoice.getCanonicalBlockByRoot.mockReturnValue(attested);
    forkChoice.getBlockDefaultStatus.mockReturnValue(target);

    const result = await engine.produceAttestationData(SLOTS_PER_EPOCH + 3);
    expect(result).toMatchObject({
      ok: true,
      data: {beaconBlockRoot: fromHex(attested.blockRoot), target: {epoch: 1, root: fromHex(target.blockRoot)}},
    });
    expect(forkChoice.getBlockDefaultStatus).toHaveBeenCalledWith(fromHex(target.blockRoot));
  });

  it("keeps source regeneration on the selected head when fork choice changes while waiting", async () => {
    const selectedHead = head;
    const state = defer<IBeaconStateView>();
    regen.getBlockSlotState.mockReturnValue(state.promise);
    const resultPromise = engine.produceAttestationData(2 * SLOTS_PER_EPOCH);
    expect(regen.getBlockSlotState).toHaveBeenCalledWith(
      selectedHead,
      2 * SLOTS_PER_EPOCH,
      {dontTransferCache: true},
      RegenCaller.produceAttestationData
    );
    head = {...head, blockRoot: root(9)};
    const nextSource = {epoch: 1, root: fromHex(selectedHead.blockRoot)};
    state.resolve({currentJustifiedCheckpoint: nextSource} as IBeaconStateView);
    expect(await resultPromise).toMatchObject({
      ok: true,
      data: {beaconBlockRoot: fromHex(selectedHead.blockRoot), source: nextSource},
    });
  });

  it("preserves pre-Electra committee validation and index", async () => {
    Object.assign(core, {config: createBeaconConfig({}, Buffer.alloc(32))});
    expect(await engine.produceAttestationData(head.slot)).toMatchObject({
      ok: false,
      code: BeaconEngineErrorCode.API_ERROR,
      payload: {status: 400},
    });
    expect(await engine.produceAttestationData(head.slot, 7)).toMatchObject({ok: true, data: {index: 7}});
  });

  it.each([
    ["unknown", null, BeaconEngineErrorCode.API_ERROR],
    ["optimistic", {executionStatus: ExecutionStatus.Syncing}, BeaconEngineErrorCode.NODE_SYNCING],
    ["out of range", {dataAvailabilityStatus: DataAvailabilityStatus.OutOfRange}, BeaconEngineErrorCode.NODE_SYNCING],
  ] as const)("rejects %s blocks for attestations and contributions", async (_, overrides, code) => {
    forkChoice.getBlockDefaultStatus.mockReturnValue(
      overrides === null ? null : generateProtoBlock({blockRoot: head.blockRoot, slot: head.slot, ...overrides})
    );
    expect(await engine.produceAttestationData(head.slot)).toMatchObject({ok: false, code});
    expect(await engine.produceSyncCommitteeContribution(0, head.slot, fromHex(head.blockRoot))).toMatchObject({
      ok: false,
      code,
    });
    expect(getContribution).not.toHaveBeenCalled();
  });

  it("returns exact-slot payload-attestation blocks without requiring FULL", async () => {
    head = {...head, payloadStatus: PayloadStatus.PENDING};
    const selected = await engine.getPayloadAttestationBlock(head.slot);
    expect(selected).toEqual({blockRoot: head.blockRoot, slot: head.slot});
    head.slot++;
    expect(selected?.slot).toBe(SLOTS_PER_EPOCH);
    forkChoice.getCanonicalBlockAtSlot.mockReturnValue(null);
    expect(await engine.getPayloadAttestationBlock(head.slot)).toBeNull();
  });

  it("returns contribution bytes from Core and restores BitArray at the facade", async () => {
    const contribution = ssz.altair.SyncCommitteeContribution.defaultValue();
    contribution.aggregationBits.set(3, true);
    getContribution.mockReturnValue(contribution);
    const response = structuredClone(core.produceSyncCommitteeContribution(0, head.slot, fromHex(head.blockRoot)));
    expect(response).toMatchObject({ok: true, data: expect.any(Uint8Array)});
    vi.spyOn(core, "produceSyncCommitteeContribution").mockReturnValue(response);
    const result = await engine.produceSyncCommitteeContribution(0, head.slot, fromHex(head.blockRoot));
    if (!result.ok || !result.data) throw Error("Expected a contribution");
    expect(result.data.aggregationBits.getTrueBitIndexes()).toEqual([3]);
  });

  it("preserves an empty contribution result", async () => {
    getContribution.mockReturnValue(null);
    expect(await engine.produceSyncCommitteeContribution(0, head.slot, fromHex(head.blockRoot))).toEqual({
      ok: true,
      data: null,
    });
  });
});
