import {EventEmitter} from "node:events";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {IBeaconChain} from "../../../../src/chain/interface.js";
import {PqAggregationScheduler} from "../../../../src/chain/pq/aggregationScheduler.js";
import {ClockEvent} from "../../../../src/util/clock.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

describe("PqAggregationScheduler", () => {
  const config = createChainForkConfig({...defaultConfig, GLOAS_FORK_EPOCH: 0, PQ_FORK_EPOCH: 0});
  const slot = 10;
  const committeeIndex = 1;
  const aggregationCommittee = [50, 51, 52, 53];
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
    const chain = {
      clock,
      genesisTime: 0,
      getHeadState: () => ({getAggregationCommittee: () => aggregationCommittee}),
      pqAttestationPool: {proveAggregate},
    } as unknown as IBeaconChain;
    scheduler = new PqAggregationScheduler(chain, config, getMockedLogger(), controller.signal);
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

  it("proves a committee at the cutoff of the first of this node's aggregators", async () => {
    scheduler.addAggregator(slot, committeeIndex, aggregationCommittee[3]);
    scheduler.addAggregator(slot, committeeIndex, aggregationCommittee[1]);
    startSlot();

    await vi.advanceTimersByTimeAsync(config.getAggregationCutoffMs(ForkName.pq, 1) - 1);
    expect(proveAggregate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(proveAggregate).toHaveBeenCalledExactlyOnceWith(slot, committeeIndex);
  });

  it("proves nothing for a validator the state does not name an aggregator", async () => {
    scheduler.addAggregator(slot, committeeIndex, 99);
    startSlot();

    await vi.advanceTimersByTimeAsync(config.SLOT_DURATION_MS);
    expect(proveAggregate).not.toHaveBeenCalled();
  });

  it("leaves an aggregator named in its slot to be proven for when it asks", async () => {
    startSlot();
    scheduler.addAggregator(slot, committeeIndex, aggregationCommittee[0]);

    await vi.advanceTimersByTimeAsync(config.SLOT_DURATION_MS);
    expect(proveAggregate).not.toHaveBeenCalled();
  });
});
