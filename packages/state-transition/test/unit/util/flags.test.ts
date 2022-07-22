import {expect} from "chai";

describe("Altair status flags", () => {
  for (let prev = 0b000; prev <= 0b111; prev++) {
    for (let att = 0b000; att <= 0b111; att++) {
      it(`prevFlag ${toStr(prev)} attFlag ${toStr(att)}`, () => {
        expect(
          // Actual function
          toStr(getResFlags(prev, att))
        ).to.equal(
          // Naive but correct implementation
          toStr(getResFlagsNaive(prev, att))
        );
      });
    }
  }
});

function toStr(flags: number): string {
  return flags.toString(2).padStart(3, "0");
}

function getResFlags(prev: number, att: number): number {
  return ~prev & att;
}

function getResFlagsNaive(prev: number, att: number): number {
  let out = 0;

  for (let i = 0; i < 3; i++) {
    const mask = 1 << i;
    const hasPrev = (prev & mask) === mask;
    const hasAtt = (att & mask) === mask;
    if (!hasPrev && hasAtt) {
      out |= mask;
    }
  }

  return out;
}
