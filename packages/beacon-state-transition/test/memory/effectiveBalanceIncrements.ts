import {MutableVector} from "@chainsafe/persistent-ts";
import {testRunnerMemory} from "@chainsafe/lodestar/test/memory/testRunnerMemory";
import {newZeroedArray} from "../../src/index.js";

// Results in Linux Feb 2022
//
// EffectiveBalanceIncrements Uint8Array 300000              - 299873.5 bytes / instance
// EffectiveBalanceIncrements array 300000                   - 2400093.1 bytes / instance
// EffectiveBalanceIncrements MutableVector 300000           - 4380557.0 bytes / instance
// EffectiveBalanceIncrements MutableVector 300000 cloned 10 - 4399575.0 bytes / instance
//
// With MutableVector, break even at 14 instances of Uint8Array
// 4380557 / 299873 = 14

const vc = 300_000;
const cloneTimes = 10;

testRunnerMemoryBpi([
  {
    id: `EffectiveBalanceIncrements Uint8Array ${vc}`,
    getInstance: () => new Uint8Array(vc),
  },
  {
    id: `EffectiveBalanceIncrements array ${vc}`,
    getInstance: () => newZeroedArray(vc),
  },
  {
    id: `EffectiveBalanceIncrements MutableVector ${vc}`,
    getInstance: () => MutableVector.from(newZeroedArray(vc)),
  },
  {
    id: `EffectiveBalanceIncrements MutableVector ${vc} cloned ${cloneTimes}`,
    getInstance: () => {
      const mv = MutableVector.from(newZeroedArray(vc));
      const mvs = [mv];
      for (let i = 0; i < cloneTimes; i++) {
        const mvc = mv.clone();
        mvc.push(0);
        mvs.push(mvc);
      }
      return mvs;
    },
  },
]);

/**
 * Test bytes per instance in different representations of raw binary data
 */
function testRunnerMemoryBpi(testCases: {getInstance: (bytes: number) => unknown; id: string}[]): void {
  const longestId = Math.max(...testCases.map(({id}) => id.length));

  for (const {id, getInstance} of testCases) {
    const bpi = testRunnerMemory({
      getInstance,
      convergeFactor: 1 / 100,
      sampleEvery: 5,
    });

    // eslint-disable-next-line no-console
    console.log(`${id.padEnd(longestId)} - ${bpi.toFixed(1)} bytes / instance`);
  }
}
