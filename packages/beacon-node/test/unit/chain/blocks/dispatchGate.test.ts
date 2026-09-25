import {createHash} from "node:crypto";
import {describe, expect, it, vi} from "vitest";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {BlockInputColumns, BlockInputSource, IBlockInput} from "../../../../src/chain/blocks/blockInput/index.js";
import {
  DispatchArm,
  DispatchGateSwitch,
  DispatchSchedule,
  EPOCHS_PER_ARM,
  firstArmOfPair,
  parseDispatchSchedule,
} from "../../../../src/chain/blocks/dispatchGate.js";
import {Metrics} from "../../../../src/metrics/index.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

const startEpoch = 100;
const schedule: DispatchSchedule = {seed: 42, startEpoch, pairs: 3};

function fuluBlock(slot: number, source = BlockInputSource.gossip): IBlockInput {
  const block = ssz.fulu.SignedBeaconBlock.defaultValue();
  block.message.slot = slot;
  return BlockInputColumns.createFromBlock({
    forkName: ForkName.fulu,
    block,
    blockRootHex: "0xaa",
    source,
    seenTimestampSec: 0,
    daOutOfRange: false,
    sampledColumns: [0],
    custodyColumns: [0],
  });
}

function setup(scheduleOrNull: DispatchSchedule | null, epoch = startEpoch) {
  const clock = new ClockStopped(epoch * SLOTS_PER_EPOCH);
  const collects: (() => void)[] = [];
  const gauge = () => ({set: vi.fn(), addCollect: (fn: () => void) => collects.push(fn)});
  const metrics = {dispatchGate: {arm: gauge(), forcedControl: gauge()}};
  const gate = new DispatchGateSwitch(scheduleOrNull, clock, getMockedLogger(), metrics as unknown as Metrics);
  return {
    gate,
    clock,
    metrics: metrics.dispatchGate,
    /** The arm of a live gossip block at the start of `epoch` */
    armAt(atEpoch: number): DispatchArm | null {
      clock.setSlot(atEpoch * SLOTS_PER_EPOCH);
      return gate.armOf([fuluBlock(atEpoch * SLOTS_PER_EPOCH)], {});
    },
    scrape(): void {
      for (const collect of collects) collect();
    },
  };
}

describe("chain / blocks / dispatchGate / switch", () => {
  it("draws each pair's first arm from sha256 of the seed and pair", () => {
    for (let pair = 0; pair < 16; pair++) {
      const input = Buffer.alloc(16);
      input.writeBigUInt64LE(BigInt(schedule.seed), 0);
      input.writeBigUInt64LE(BigInt(pair), 8);
      const bit = createHash("sha256").update(input).digest()[0] & 1;
      expect(firstArmOfPair(schedule.seed, pair)).toBe(bit === 1 ? DispatchArm.treatment : DispatchArm.control);
    }
    const orders = Array.from({length: 64}, (_, pair) => firstArmOfPair(1, pair));
    expect(orders).toContain(DispatchArm.treatment);
    expect(orders).toContain(DispatchArm.control);
  });

  it("alternates the arms of each pair in the drawn order, and is control outside the schedule", () => {
    const t = setup(schedule);
    expect(t.armAt(startEpoch - 1)).toBe(DispatchArm.control);
    const firstArms = t.gate.getState().schedule?.firstArms;
    expect(firstArms).toEqual([0, 1, 2].map((pair) => firstArmOfPair(schedule.seed, pair)));
    for (let pair = 0; pair < schedule.pairs; pair++) {
      const first = firstArmOfPair(schedule.seed, pair);
      const second = first === DispatchArm.treatment ? DispatchArm.control : DispatchArm.treatment;
      for (let i = 0; i < 2 * EPOCHS_PER_ARM; i++) {
        expect(t.armAt(startEpoch + pair * 2 * EPOCHS_PER_ARM + i)).toBe(i < EPOCHS_PER_ARM ? first : second);
      }
    }
    expect(t.armAt(startEpoch + schedule.pairs * 2 * EPOCHS_PER_ARM)).toBe(DispatchArm.control);
  });

  it("is control without a schedule", () => {
    const t = setup(null);
    for (let epoch = startEpoch; epoch < startEpoch + 2 * EPOCHS_PER_ARM; epoch++) {
      expect(t.armAt(epoch)).toBe(DispatchArm.control);
    }
    expect(t.gate.getState()).toEqual({
      schedule: null,
      forceControl: false,
      currentEpoch: startEpoch + 2 * EPOCHS_PER_ARM - 1,
      currentArm: DispatchArm.control,
    });
  });

  it("forces control while the override is set and exports the current arm", () => {
    const t = setup(schedule);
    const treatmentEpoch =
      startEpoch + (firstArmOfPair(schedule.seed, 0) === DispatchArm.treatment ? 0 : EPOCHS_PER_ARM);
    expect(t.armAt(treatmentEpoch)).toBe(DispatchArm.treatment);
    t.scrape();
    expect(t.metrics.arm.set).toHaveBeenLastCalledWith(1);

    t.gate.setForceControl(true);
    expect(t.armAt(treatmentEpoch)).toBe(DispatchArm.control);
    expect(t.gate.getState()).toMatchObject({forceControl: true, currentArm: DispatchArm.control});
    t.scrape();
    expect(t.metrics.arm.set).toHaveBeenLastCalledWith(0);
    expect(t.metrics.forcedControl.set).toHaveBeenLastCalledWith(1);

    t.gate.setForceControl(false);
    expect(t.armAt(treatmentEpoch)).toBe(DispatchArm.treatment);
  });

  it("assigns an arm only to a single live Fulu gossip block that verifies its payload", () => {
    const t = setup(schedule);
    const slot = t.clock.currentSlot;
    expect(t.gate.armOf([fuluBlock(slot)], {})).not.toBeNull();
    expect(t.gate.armOf([fuluBlock(slot - 1)], {})).not.toBeNull();
    expect(t.gate.armOf([fuluBlock(slot), fuluBlock(slot + 1)], {})).toBeNull();
    expect(t.gate.armOf([fuluBlock(slot - 2)], {})).toBeNull();
    expect(t.gate.armOf([fuluBlock(slot, BlockInputSource.byRoot)], {})).toBeNull();
    expect(t.gate.armOf([fuluBlock(slot)], {skipVerifyExecutionPayload: true})).toBeNull();
    const deneb = {...fuluBlock(slot), type: "blobs"} as unknown as IBlockInput;
    expect(t.gate.armOf([deneb], {})).toBeNull();
  });

  it("parses a schedule set together, or none", () => {
    expect(parseDispatchSchedule({})).toBeNull();
    expect(parseDispatchSchedule({dispatchGateSeed: 1, dispatchGateStartEpoch: 2, dispatchGatePairs: 3})).toEqual({
      seed: 1,
      startEpoch: 2,
      pairs: 3,
    });
    expect(() => parseDispatchSchedule({dispatchGateSeed: 1})).toThrow();
    expect(() =>
      parseDispatchSchedule({dispatchGateSeed: 1, dispatchGateStartEpoch: 2, dispatchGatePairs: 0})
    ).toThrow();
    expect(() =>
      parseDispatchSchedule({dispatchGateSeed: 1.5, dispatchGateStartEpoch: 2, dispatchGatePairs: 1})
    ).toThrow();
  });
});
