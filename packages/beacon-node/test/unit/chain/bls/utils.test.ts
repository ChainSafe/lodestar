import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {chunkifyMaximizeChunkSize} from "../../../../src/chain/bls/multithread/utils.js";
import {linspace} from "../../../../src/util/numpy.js";

describe("chain / bls / utils / chunkifyMaximizeChunkSize", () => {
  const minPerChunk = 3;
  const testCases = [
    [[0]],
    [[0, 1]],
    [[0, 1, 2]],
    [[0, 1, 2, 3]],
    [[0, 1, 2, 3, 4]],
    [
      [0, 1, 2],
      [3, 4, 5],
    ],
    [
      [0, 1, 2, 3],
      [4, 5, 6],
    ],
    [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ],
  ];

  for (const [i, testCase] of testCases.entries()) {
    it(`array len ${i + 1}`, () => {
      const arr = linspace(0, i);
      const chunks = chunkifyMaximizeChunkSize(arr, minPerChunk);
      expect(chunks).toEqual(testCase);
    });
  }
});

describe("chain / bls / utils / measureHrtimeOffsetMs", () => {
  it("maps hrtime stamps no later than performance.now() observes them, calibrated in a cold process", () => {
    const utils = fileURLToPath(new URL("../../../../src/chain/bls/multithread/utils.ts", import.meta.url));
    // A fresh process whose first performance.now() access is the calibration's, as when the pool module loads first
    const script = `
      const {measureHrtimeOffsetMs} = await import(${JSON.stringify(utils)});
      const offset = measureHrtimeOffsetMs();
      let late = -Infinity;
      let early = Infinity;
      for (let i = 0; i < 10000; i++) {
        const [sec, ns] = process.hrtime();
        const stamp = sec * 1000 + ns / 1e6 - offset;
        const observed = performance.now();
        late = Math.max(late, stamp - observed);
        early = Math.min(early, observed - stamp);
      }
      console.log(JSON.stringify({late, early}));
    `;
    const output = execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", script], {
      encoding: "utf8",
    });
    const {late, early} = JSON.parse(output) as {late: number; early: number};
    expect(late).toBeLessThanOrEqual(0);
    // Nor much earlier: the tightest stamp is within a bracket of when it was observed
    expect(early).toBeLessThan(0.5);
  });
});
