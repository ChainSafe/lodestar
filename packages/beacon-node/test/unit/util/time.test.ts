import {expect} from "chai";
import {prettyTimeDiffSec} from "../../../src/util/time.js";

describe("util / time / prettyTimeDiffSec", () => {
  const testCases: {diffSec: number; res: string}[] = [
    {diffSec: 1.5, res: "1.5 seconds"},
    {diffSec: 15, res: "15 seconds"},
    {diffSec: 100, res: "1.7 minutes"},
    {diffSec: 1000, res: "17 minutes"},
    {diffSec: 10000, res: "2.8 hours"},
    {diffSec: 50000, res: "14 hours"},
    {diffSec: 100000, res: "1.2 days"},
    {diffSec: 500000, res: "5.8 days"},
  ];

  for (const {diffSec, res} of testCases) {
    it(`pretty ${diffSec}`, () => {
      expect(prettyTimeDiffSec(diffSec)).to.equal(res);
    });
  }
});
