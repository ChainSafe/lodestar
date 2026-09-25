import {digest} from "@chainsafe/as-sha256";
import {routes} from "@lodestar/api";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {HttpRequestTimes} from "../../execution/engine/jsonRpcHttpClient.js";
import {Metrics} from "../../metrics/index.js";
import {IClock} from "../../util/clock.js";
import {BlockProcessOpts} from "../options.js";
import {isBlockInputColumns} from "./blockInput/blockInput.js";
import {BlockInputSource, IBlockInput} from "./blockInput/types.js";

/** A block's arm in the pre-state-transition engine dispatch experiment */
export enum DispatchArm {
  control = "control",
  treatment = "treatment",
}

/** Epochs in each arm of a crossover pair */
export const EPOCHS_PER_ARM = 4;
/** Requested bound of the treatment's wait before the state transition; the event loop can run its timeout late */
export const DISPATCH_GATE_DEADLINE_MS = 10;

/**
 * - both_sent: newPayload's and the getBlobs call's first attempts each handed their body to the connection
 * - new_payload_only: newPayload's did, and no getBlobs call was in progress or its first attempt sent nothing
 * - fell_back: the deadline passed first
 * - skipped: newPayload's first attempt ended without sending its body
 */
export type DispatchGateOutcome = "both_sent" | "new_payload_only" | "fell_back" | "skipped";
/** The root's getBlobs call when the gate started: none in progress or it sent nothing, not yet sent, or sent */
export type GetBlobsAtGate = "none" | "pending" | "dispatched";
export type DispatchGateResult = {
  outcome: DispatchGateOutcome;
  getBlobs: GetBlobsAtGate;
  /** The `performance.now()` time the gate started */
  start: number;
  /** From the gate's start to its end */
  ms: number;
  /** How late the deadline's timeout ran, NaN unless the gate fell back */
  overshootMs: number;
};

/**
 * Waits until newPayload's first attempt, and the root's getBlobs call's when it has not sent yet, has handed its body to
 * the connection or ended, for at most `deadlineMs`. It waits for no response and starts no request.
 */
export function awaitEngineDispatch(
  newPayload: HttpRequestTimes,
  getBlobs: HttpRequestTimes | null,
  deadlineMs: number
): Promise<DispatchGateResult> {
  const start = performance.now();
  const getBlobsAtGate: GetBlobsAtGate =
    getBlobs === null || (getBlobs.firstAttemptEnded && Number.isNaN(getBlobs.firstSent))
      ? "none"
      : getBlobs.firstAttemptEnded
        ? "dispatched"
        : "pending";
  const waited = getBlobsAtGate === "pending" ? getBlobs : null;

  return new Promise((resolve) => {
    let timeout: NodeJS.Timeout | undefined;
    const finish = (timedOutAt: number): void => {
      clearTimeout(timeout);
      newPayload.onFirstAttemptEnd = null;
      if (waited) waited.onFirstAttemptEnd = null;
      const fellBack = !Number.isNaN(timedOutAt);
      const newPayloadSent = !Number.isNaN(newPayload.firstSent);
      const getBlobsSent = getBlobs !== null && !Number.isNaN(getBlobs.firstSent);
      resolve({
        outcome: fellBack ? "fell_back" : !newPayloadSent ? "skipped" : getBlobsSent ? "both_sent" : "new_payload_only",
        getBlobs: getBlobsAtGate,
        start,
        ms: performance.now() - start,
        overshootMs: fellBack ? timedOutAt - start - deadlineMs : NaN,
      });
    };
    const onEnd = (): void => {
      if (newPayload.firstAttemptEnded && (waited === null || waited.firstAttemptEnded)) finish(NaN);
    };
    newPayload.onFirstAttemptEnd = onEnd;
    if (waited) waited.onFirstAttemptEnd = onEnd;
    timeout = setTimeout(() => finish(performance.now()), deadlineMs);
    onEnd();
  });
}

export function observeDispatchGate(metrics: Metrics | null, result: DispatchGateResult): void {
  if (!metrics) return;
  const {outcome, getBlobs, ms, overshootMs} = result;
  metrics.dispatchGate.gates.inc({outcome, getblobs: getBlobs});
  metrics.dispatchGate.duration.observe({outcome}, ms / 1000);
  if (!Number.isNaN(overshootMs)) metrics.dispatchGate.overshoot.observe(overshootMs / 1000);
}

/** From `startEpoch`, `pairs` pairs of arms, each pair's order drawn from `seed` */
export type DispatchSchedule = {seed: number; startEpoch: Epoch; pairs: number};

/**
 * The first arm of crossover pair `pair`: treatment when the low bit of the first byte of
 * sha256(uint64le(seed) || uint64le(pair)) is set, else control.
 */
export function firstArmOfPair(seed: number, pair: number): DispatchArm {
  const input = Buffer.alloc(16);
  input.writeBigUInt64LE(BigInt(seed), 0);
  input.writeBigUInt64LE(BigInt(pair), 8);
  return (digest(input)[0] & 1) === 1 ? DispatchArm.treatment : DispatchArm.control;
}

/** Parses the schedule options, which are set together or not at all */
export function parseDispatchSchedule(opts: {
  dispatchGateSeed?: number;
  dispatchGateStartEpoch?: number;
  dispatchGatePairs?: number;
}): DispatchSchedule | null {
  const {dispatchGateSeed: seed, dispatchGateStartEpoch: startEpoch, dispatchGatePairs: pairs} = opts;
  if (seed === undefined && startEpoch === undefined && pairs === undefined) return null;
  if (seed === undefined || startEpoch === undefined || pairs === undefined) {
    throw Error("The dispatch gate seed, start epoch and pairs must be set together");
  }
  for (const [name, value, min] of [
    ["seed", seed, 0],
    ["start epoch", startEpoch, 0],
    ["pairs", pairs, 1],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < min) throw Error(`Invalid dispatch gate ${name} ${value}`);
  }
  return {seed, startEpoch, pairs};
}

/**
 * Assigns each block processing attempt an arm of the dispatch experiment when its verification starts, so a block in
 * flight keeps its arm. Blocks are control unless the seeded crossover schedule puts their epoch in a treatment arm,
 * and the control override, set at runtime through the API, forces control whatever the schedule.
 */
export class DispatchGateSwitch {
  private forceControl = false;
  private readonly firstArms: DispatchArm[];

  constructor(
    private readonly schedule: DispatchSchedule | null,
    private readonly clock: IClock,
    private readonly logger: Logger,
    metrics: Metrics | null
  ) {
    this.firstArms = [];
    for (let pair = 0; schedule !== null && pair < schedule.pairs; pair++) {
      this.firstArms.push(firstArmOfPair(schedule.seed, pair));
    }
    if (schedule !== null) {
      logger.info("Dispatch gate crossover schedule", {...schedule, epochsPerArm: EPOCHS_PER_ARM});
    }
    if (metrics) {
      const {arm, forcedControl} = metrics.dispatchGate;
      arm.addCollect(() => arm.set(this.armAt(this.clock.currentEpoch) === DispatchArm.treatment ? 1 : 0));
      forcedControl.addCollect(() => forcedControl.set(this.forceControl ? 1 : 0));
    }
  }

  /** The arm of a processing attempt's blocks, null unless they are a single live Fulu gossip block */
  armOf(blocks: IBlockInput[], opts: BlockProcessOpts): DispatchArm | null {
    if (blocks.length !== 1 || opts.skipVerifyExecutionPayload === true) return null;
    const block = blocks[0];
    if (!isBlockInputColumns(block) || block.getBlockSource().source !== BlockInputSource.gossip) return null;
    // The block trace's open window
    if (Math.abs(block.slot - this.clock.currentSlot) > 1) return null;
    return this.armAt(computeEpochAtSlot(block.slot));
  }

  setForceControl(forceControl: boolean): void {
    if (forceControl !== this.forceControl) this.logger.info("Dispatch gate control override", {forceControl});
    this.forceControl = forceControl;
  }

  getState(): routes.lodestar.DispatchGateState {
    const {schedule} = this;
    const currentEpoch = this.clock.currentEpoch;
    return {
      schedule: schedule && {...schedule, epochsPerArm: EPOCHS_PER_ARM, firstArms: this.firstArms.slice()},
      forceControl: this.forceControl,
      currentEpoch,
      currentArm: this.armAt(currentEpoch),
    };
  }

  private armAt(epoch: Epoch): DispatchArm {
    if (this.forceControl || this.schedule === null) return DispatchArm.control;
    const offset = epoch - this.schedule.startEpoch;
    const pair = Math.floor(offset / (2 * EPOCHS_PER_ARM));
    if (offset < 0 || pair >= this.firstArms.length) return DispatchArm.control;
    const first = this.firstArms[pair];
    if (offset % (2 * EPOCHS_PER_ARM) < EPOCHS_PER_ARM) return first;
    return first === DispatchArm.treatment ? DispatchArm.control : DispatchArm.treatment;
  }
}
