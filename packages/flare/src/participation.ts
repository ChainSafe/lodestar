import {ssz} from "@lodestar/types";
import {getClient} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {TIMELY_HEAD_FLAG_INDEX, TIMELY_SOURCE_FLAG_INDEX, TIMELY_TARGET_FLAG_INDEX} from "@lodestar/params";

/* eslint-disable no-console */

const client = getClient({baseUrl: "http://localhost:4000"}, {config});

const stateBytes = await client.debug.getStateV2("head", "ssz");
const state = ssz.bellatrix.BeaconState.deserialize(stateBytes);

const TIMELY_SOURCE = 1 << TIMELY_SOURCE_FLAG_INDEX;
const TIMELY_TARGET = 1 << TIMELY_TARGET_FLAG_INDEX;
const TIMELY_HEAD = 1 << TIMELY_HEAD_FLAG_INDEX;

const sourceByK = new Map<number, number>();
const targetByK = new Map<number, number>();
const headByK = new Map<number, number>();

for (let i = 0; i < state.previousEpochParticipation.length; i++) {
  const flags = state.previousEpochParticipation[i];
  const {source, target, head} = parseParticipation(flags);

  const k = i - (i % 1000);

  if (source) sourceByK.set(k, (sourceByK.get(k) ?? 0) + 1);
  if (target) targetByK.set(k, (targetByK.get(k) ?? 0) + 1);
  if (head) headByK.set(k, (headByK.get(k) ?? 0) + 1);

  // console.log(String(i).padStart(6), flags.toString(2).padStart(3, "0"));
}

console.log("indexes   sorc targ head");

for (let k = 0; k < state.previousEpochParticipation.length; k += 1000) {
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
