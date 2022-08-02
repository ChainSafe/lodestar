import {altair} from "@lodestar/types";
import {ForkName, TIMELY_HEAD_FLAG_INDEX, TIMELY_SOURCE_FLAG_INDEX, TIMELY_TARGET_FLAG_INDEX} from "@lodestar/params";
import {downloadHeadState} from "./downloadHeadState.js";

/* eslint-disable no-console */

const {state, fork} = await downloadHeadState();

const TIMELY_SOURCE = 1 << TIMELY_SOURCE_FLAG_INDEX;
const TIMELY_TARGET = 1 << TIMELY_TARGET_FLAG_INDEX;
const TIMELY_HEAD = 1 << TIMELY_HEAD_FLAG_INDEX;

const sourceByK = new Map<number, number>();
const targetByK = new Map<number, number>();
const headByK = new Map<number, number>();

if (fork === ForkName.phase0) {
  throw Error("State still in phase0");
}

const stateAltair = state as altair.BeaconState;
const validatorCount = stateAltair.previousEpochParticipation.length;

for (let i = 0; i < validatorCount; i++) {
  const flags = stateAltair.previousEpochParticipation[i];
  const {source, target, head} = parseParticipation(flags);

  const k = i - (i % 1000);

  if (source) sourceByK.set(k, (sourceByK.get(k) ?? 0) + 1);
  if (target) targetByK.set(k, (targetByK.get(k) ?? 0) + 1);
  if (head) headByK.set(k, (headByK.get(k) ?? 0) + 1);

  // console.log(String(i).padStart(6), flags.toString(2).padStart(3, "0"));
}

console.log("indexes   sorc targ head");

for (let k = 0; k < validatorCount; k += 1000) {
  const values = [sourceByK.get(k) ?? 0, targetByK.get(k) ?? 0, headByK.get(k) ?? 0]
    .map((val) => val.toString(10).padStart(4))
    .join(" ");

  console.log(k.toString(10).padEnd(6), "=>", values);
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function parseParticipation(flag: number) {
  return {
    source: (flag & TIMELY_SOURCE) === TIMELY_SOURCE,
    target: (flag & TIMELY_TARGET) === TIMELY_TARGET,
    head: (flag & TIMELY_HEAD) === TIMELY_HEAD,
  };
}
