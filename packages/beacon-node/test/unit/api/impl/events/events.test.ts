import {describe, it, expect, beforeEach, afterEach, vi, MockedObject} from "vitest";
import {routes} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {BeaconChain, ChainEventEmitter, HeadEventData} from "../../../../../src/chain/index.js";
import {getEventsApi} from "../../../../../src/api/impl/events/index.js";
import {ZERO_HASH_HEX} from "../../../../../src/constants/constants.js";

vi.mock("../../../../../src/chain/index.js", async (importActual) => {
  const mod = await importActual<typeof import("../../../../../src/chain/index.js")>();

  return {
    ...mod,
    BeaconChain: vi.spyOn(mod, "BeaconChain").mockImplementation(() => {
      return {
        emitter: new ChainEventEmitter(),
        forkChoice: {
          getHead: vi.fn(),
        },
      } as unknown as BeaconChain;
    }),
  };
});

describe("Events api impl", () => {
  describe("beacon event stream", () => {
    let chainStub: MockedObject<BeaconChain>;
    let chainEventEmmitter: ChainEventEmitter;
    let api: ReturnType<typeof getEventsApi>;
    let controller: AbortController;

    beforeEach(() => {
      chainStub = vi.mocked(new BeaconChain({} as any, {} as any), {partial: true, deep: false});
      chainEventEmmitter = chainStub.emitter;
      api = getEventsApi({config, chain: chainStub});
      controller = new AbortController();
    });

    afterEach(() => controller.abort());

    function getEvents(topics: routes.events.EventType[]): routes.events.BeaconEvent[] {
      const events: routes.events.BeaconEvent[] = [];
      void api.eventstream({
        topics,
        signal: controller.signal,
        onEvent: (event) => {
          events.push(event);
        },
      });
      return events;
    }

    const headEventData: HeadEventData = {
      slot: 0,
      block: ZERO_HASH_HEX,
      state: ZERO_HASH_HEX,
      epochTransition: false,
      previousDutyDependentRoot: ZERO_HASH_HEX,
      currentDutyDependentRoot: ZERO_HASH_HEX,
      executionOptimistic: false,
    };

    it("should ignore not sent topics", async () => {
      const events = getEvents([routes.events.EventType.head]);

      chainEventEmmitter.emit(routes.events.EventType.attestation, ssz.phase0.Attestation.defaultValue());
      chainEventEmmitter.emit(routes.events.EventType.head, headEventData);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(routes.events.EventType.head);
      expect(events[0].message).not.toBeNull();
    });
  });
});
