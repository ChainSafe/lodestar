import {afterEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView, computeTimeAtSlot} from "@lodestar/state-transition";
import {runNodeNotifier} from "../../../src/node/notifier.js";
import {SyncState} from "../../../src/sync/interface.js";
import {getApiTestModules} from "../../utils/api.js";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";
import {generateState, zeroProtoBlock} from "../../utils/state.js";

// The slot-time helper will support changing durations in #9933.
vi.mock("@lodestar/state-transition", async (importActual) => ({
  ...(await importActual<typeof import("@lodestar/state-transition")>()),
  computeTimeAtSlot: vi.fn(),
}));

describe("node notifier", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe.each([6000, 12000, 24000])("next slot duration %i ms", (nextDuration) => {
    it.each([3000, 6000, 9000])("logs at slot midpoints when starting %i ms into the slot", async (offset) => {
      const slotDuration = 12000;
      const boundarySlot = SLOTS_PER_EPOCH;
      const boundaryTime = boundarySlot * slotDuration;
      const startTime = boundaryTime - slotDuration + offset;
      vi.useFakeTimers({now: startTime});
      const config = createBeaconConfig({ALTAIR_FORK_EPOCH: 1}, Buffer.alloc(32));
      const modules = getApiTestModules({config, genesisTime: 0});
      const {chain, network, sync} = modules;
      const logger = chain.logger;
      network.getConnectedPeerCount = vi.fn().mockReturnValue(2);
      vi.spyOn(sync, "state", "get").mockReturnValue(SyncState.Synced);
      vi.spyOn(chain.clock, "currentSlot", "get").mockImplementation(() =>
        Date.now() < boundaryTime
          ? Math.floor(Date.now() / slotDuration)
          : boundarySlot + Math.floor((Date.now() - boundaryTime) / nextDuration)
      );
      vi.mocked(computeTimeAtSlot).mockImplementation(
        (_config, slot, genesisTime) =>
          genesisTime +
          (slot < boundarySlot ? slot * slotDuration : boundaryTime + (slot - boundarySlot) * nextDuration) / 1000
      );
      chain.forkChoice.getHead.mockReturnValue(zeroProtoBlock);
      chain.getHeadState.mockReturnValue(
        new BeaconStateView(createCachedBeaconStateTest(generateState({}, config), config))
      );
      const controller = new AbortController();
      const notifying = runNodeNotifier({...modules, config, signal: controller.signal});

      try {
        expect(logger.info).toHaveBeenCalledOnce();
        logger.info.mockClear();
        const midpoints = [
          ...(offset < slotDuration / 2 ? [boundaryTime - slotDuration / 2] : []),
          boundaryTime + nextDuration / 2,
          boundaryTime + (3 * nextDuration) / 2,
        ];

        for (const midpoint of midpoints) {
          await vi.advanceTimersByTimeAsync(midpoint - Date.now() - 1);
          expect(logger.info, `before midpoint ${midpoint}`).not.toHaveBeenCalled();
          await vi.advanceTimersByTimeAsync(1);
          expect(logger.info, `at midpoint ${midpoint}`).toHaveBeenCalledExactlyOnceWith(
            expect.stringContaining(`slot: ${chain.clock.currentSlot}`)
          );
          logger.info.mockClear();
        }
        expect(logger.error).not.toHaveBeenCalled();
      } finally {
        controller.abort();
        await notifying;
      }
    });
  });
});
