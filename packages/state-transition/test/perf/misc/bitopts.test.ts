import {FLAG_PREV_SOURCE_ATTESTER, FLAG_UNSLASHED} from "../../../src/index.js";

describe.skip("bit opts", function () {
  this.timeout(0);

  it("Benchmark bitshift", () => {
    const validators = 200_000; // Prater validators
    const orOptsPerRun = 5; // in getAttestationDeltas()
    const opsRun = 1e8; // Big number to benchmark

    const from = process.hrtime.bigint();
    for (let i = 0; i < opsRun; i++) {
      FLAG_PREV_SOURCE_ATTESTER | FLAG_UNSLASHED;
    }
    const to = process.hrtime.bigint();
    const diffMs = Number(to - from) / 1e6;
    console.log(`Time spent on OR in getAttestationDeltas: ${diffMs * ((orOptsPerRun * validators) / opsRun)} ms`);
  });
});
