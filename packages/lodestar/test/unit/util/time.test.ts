import {expect} from "chai";
import {prettyTimeDiff} from "../../../src/util/time";

describe("util / time / prettyTimeDiff", () => {
  const testCases: {diffMs: number; res: string}[] = [
    {diffMs: 1500, res: "1.5 seconds"},
    {diffMs: 15000, res: "15 seconds"},
    {diffMs: 100000, res: "1.7 minutes"},
    {diffMs: 1000000, res: "17 minutes"},
    {diffMs: 10000000, res: "2.8 hours"},
    {diffMs: 50000000, res: "14 hours"},
    {diffMs: 100000000, res: "1.2 days"},
    {diffMs: 500000000, res: "5.8 days"},
  ];

  for (const {diffMs, res} of testCases) {
    it(`pretty ${diffMs}`, () => {
      expect(prettyTimeDiff(diffMs)).to.equal(res);
    });
  }
});
