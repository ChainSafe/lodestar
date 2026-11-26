import {EventEmitter} from "node:events";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {IBeaconChain} from "../../../../src/chain/interface.js";
import {PqAggregationScheduler} from "../../../../src/chain/pq/aggregationScheduler.js";
import {ClockEvent} from "../../../../src/util/clock.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

describe("PqAggregationScheduler", () => {
  const config = createChainForkConfig({...defaultConfig, GLOAS_FORK_EPOCH: 0, PQ_FORK_EPOCH: 0});
  const slot = 10;
  const committeeIndex = 1;
  const proveAtMs = 4500;
  const slotStartMs = slot * config.SLOT_DURATION_MS;

  let controller: AbortController;
  let clock: EventEmitter & {currentSlot: number};
  let proveAggregate: ReturnType<typeof vi.fn>;
  let scheduler: PqAggregationScheduler;

  beforeEach(() => {
    vi.useFakeTimers({now: slotStartMs - config.SLOT_DURATION_MS});
    controller = new AbortController();
    clock = Object.assign(new EventEmitter(), {currentSlot: slot - 1});
    proveAggregate = vi.fn().mockResolvedValue(undefined);
    const chain = {clock, genesisTime: 0, pqAttestationPool: {proveAggregate}} as unknown as IBeaconChain;
    scheduler = new PqAggregationScheduler(chain, config, proveAtMs, getMockedLogger(), controller.signal);
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  function startSlot(): void {
    vi.setSystemTime(slotStartMs);
    clock.currentSlot = slot;
    clock.emit(ClockEvent.slot, slot);
  }

  it("proves a committee once, ahead of the aggregate's deadline", async () => {
    scheduler.addAggregator(slot, committeeIndex);
    scheduler.addAggregator(slot, committeeIndex);
    startSlot();

    await vi.advanceTimersByTimeAsync(proveAtMs - 1);
    expect(proveAggregate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(proveAggregate).toHaveBeenCalledExactlyOnceWith(slot, committeeIndex);
  });

  it("proves nothing for a committee without an aggregator of this node", async () => {
    scheduler.addAggregator(slot + 1, committeeIndex);
    startSlot();

    await vi.advanceTimersByTimeAsync(config.SLOT_DURATION_MS - 1);
    expect(proveAggregate).not.toHaveBeenCalled();
  });

  it("leaves an aggregator named in its slot to be proven for when it asks", async () => {
    startSlot();
    scheduler.addAggregator(slot, committeeIndex);

    await vi.advanceTimersByTimeAsync(config.SLOT_DURATION_MS);
    expect(proveAggregate).not.toHaveBeenCalled();
  });
});
