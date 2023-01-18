import {expect} from "chai";
import {Epoch, Slot, ValidatorIndex} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Api, HttpStatusCode} from "@lodestar/api";
import {DoppelgangerService, DoppelgangerStatus} from "../../../src/services/doppelgangerService.js";
import {IndicesService} from "../../../src/services/indices.js";
import {testLogger} from "../../utils/logger.js";
import {ClockMock} from "../../utils/clock.js";

// At genesis start validating immediately

type IsLivePrevEpoch = boolean;
type IsLiveCurrEpoch = boolean;

type DoppelgangerTest = [IsLivePrevEpoch, IsLiveCurrEpoch, DoppelgangerStatus][];
const noop = (): null => null;

/**
 * Test cases data structure, each row represents an epoch:
 *
 *  [prev, curr, expectedStatus]
 *
 *  prev = isLive in previous epoch
 *  curr = isLive in current epoch
 *  expectedStatus = assert doppelganger status at the end of epoch
 */
const testCases: Record<string, DoppelgangerTest> = {
  "isLive first epoch": [
    [true, true, DoppelgangerStatus.Unverified], // start epoch ignored
    [false, false, DoppelgangerStatus.Unverified], // !isLive, one more to go
    [false, false, DoppelgangerStatus.VerifiedSafe], // prevEpoch !isLive = safe
    [true, true, DoppelgangerStatus.VerifiedSafe], // isLive after safe ignored
  ],

  "isLive first epoch and prev": [
    [true, true, DoppelgangerStatus.Unverified],
    [true, false, DoppelgangerStatus.Unverified], // in startingEpoch + 1, prev isLive ignored
    [false, false, DoppelgangerStatus.VerifiedSafe],
  ],
  "isLive prev starting epoch": [
    [false, false, DoppelgangerStatus.Unverified],
    [true, false, DoppelgangerStatus.Unverified], // in startingEpoch + 1, prev isLive ignored
    [false, false, DoppelgangerStatus.VerifiedSafe], // no detection, then safe
  ],

  "never isLive": [
    [false, false, DoppelgangerStatus.Unverified],
    [false, false, DoppelgangerStatus.Unverified],
    [false, false, DoppelgangerStatus.VerifiedSafe], // takes 2 epoch for safe
  ],

  "isLive always": [
    [true, true, DoppelgangerStatus.Unverified], // start epoch ignored
    [true, true, DoppelgangerStatus.DoppelgangerDetected], // first isLive, detect
    [true, true, DoppelgangerStatus.DoppelgangerDetected], // already detected
  ],

  // Variations of isLive at multiple instances

  "isLive once 2": [
    [false, false, DoppelgangerStatus.Unverified],
    [false, true, DoppelgangerStatus.DoppelgangerDetected],
    [false, false, DoppelgangerStatus.DoppelgangerDetected],
  ],
  "isLive once 3": [
    [false, false, DoppelgangerStatus.Unverified],
    [false, false, DoppelgangerStatus.Unverified],
    [true, false, DoppelgangerStatus.DoppelgangerDetected],
  ],
  "isLive once 4": [
    [false, false, DoppelgangerStatus.Unverified],
    [false, false, DoppelgangerStatus.Unverified],
    [false, true, DoppelgangerStatus.DoppelgangerDetected],
  ],
};

describe("doppelganger service", () => {
  for (const [id, testCase] of Object.entries(testCases)) {
    it(id, async () => {
      const livenessMap = new MapDef<Epoch, Map<ValidatorIndex, boolean>>(() => new Map<ValidatorIndex, boolean>());
      const index = 0;
      const pubkeyHex = "0x" + "aa".repeat(48);

      const beaconApi = getMockBeaconApi(livenessMap);

      const logger = testLogger();
      const controller = new AbortController();

      // Register validator to IndicesService for doppelganger to resolve pubkey -> index
      const indicesService = new IndicesService(logger, beaconApi, null);
      indicesService.index2pubkey.set(index, pubkeyHex);
      indicesService.pubkey2index.set(pubkeyHex, index);

      // Use custom clock that allows to trigger epochs at will
      const initialEpoch = 1;
      const clock = new ClockMockMsToSlot(initialEpoch);

      const doppelganger = new DoppelgangerService(logger, clock, beaconApi, indicesService, noop, null);

      // Add validator to doppelganger
      doppelganger.registerValidator(pubkeyHex);

      // Go step by step
      for (const [step, [isLivePrev, isLiveCurr, expectedStatus]] of testCase.entries()) {
        const epoch = step + initialEpoch;
        logger.debug(`step ${step}`, {epoch, isLivePrev, isLiveCurr, expectedStatus});

        // Update liveness values at step epoch
        livenessMap.getOrDefault(epoch - 1).set(index, isLivePrev);
        livenessMap.getOrDefault(epoch).set(index, isLiveCurr);

        // Trigger clock onSlot for slot 0
        await clock.tickEpoch(epoch, controller.signal);

        // Wait for validator client to query states
        // doppelganger polls for liveness 3/4 of the last slot of the epoch
        await sleep(clock.msToSlot(computeStartSlotAtEpoch(epoch + 1)));

        // Assert doppelganger status
        const status = doppelganger.getStatus(pubkeyHex);
        expect(status).equal(expectedStatus, `Wrong status at step ${step}`);
      }
    });
  }
});

class MapDef<K, V> extends Map<K, V> {
  constructor(private readonly getDefault: () => V) {
    super();
  }

  getOrDefault(key: K): V {
    let value = super.get(key);
    if (value === undefined) {
      value = this.getDefault();
      this.set(key, value);
    }
    return value;
  }
}

type LivenessMap = Map<Epoch, Map<ValidatorIndex, boolean>>;

function getMockBeaconApi(livenessMap: LivenessMap): Api {
  return ({
    validator: {
      async getLiveness(indices, epoch) {
        return {
          response: {
            data: indices.map((index) => {
              const livenessEpoch = livenessMap.get(epoch);
              if (!livenessEpoch) throw Error(`Unknown epoch ${epoch}`);
              const isLive = livenessEpoch.get(index);
              if (isLive === undefined) throw Error(`No liveness for epoch ${epoch} index ${index}`);
              return {index, epoch, isLive};
            }),
          },
          ok: true,
          status: HttpStatusCode.OK,
        };
      },
    } as Partial<Api["validator"]>,
  } as Partial<Api>) as Api;
}

class ClockMockMsToSlot extends ClockMock {
  constructor(public currentEpoch: Epoch) {
    super();
  }

  async tickEpoch(epoch: Epoch, signal: AbortSignal): Promise<void> {
    if (epoch < this.currentEpoch) {
      throw Error(`tickEpoch ${epoch} < currentEpoch ${this.currentEpoch}`);
    }
    this.currentEpoch = epoch;
    await this.tickEpochFns(epoch, signal);
  }

  /** Milliseconds from now to a specific slot */
  msToSlot = (_slot: Slot): number => 0;
}
