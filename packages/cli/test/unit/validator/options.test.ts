import {expect} from "chai";
import {parseFeeRecipient} from "../../../src/util/index.js";

const feeRecipient = Buffer.from(Array.from({length: 20}, () => Math.round(Math.random() * 255)));
const feeRecipientString = feeRecipient.toString("hex");

describe("validator / parseFeeRecipient", () => {
  const testCases: string[] = [`0x${feeRecipientString}`, `0X${feeRecipientString}`];
  for (const testCase of testCases) {
    it(`parse ${testCase}`, () => {
      expect(`0x${feeRecipientString}`).to.be.deep.equal(parseFeeRecipient(testCase));
    });
  }
});

describe("validator / invalid feeRecipient", () => {
  const testCases: string[] = [
    feeRecipientString,
    `X0${feeRecipientString}`,
    `0x${feeRecipientString}13`,
    `0x${feeRecipientString.substr(0, 38)}`,
  ];
  for (const testCase of testCases) {
    it(`should error on ${testCase}`, () => {
      expect(() => parseFeeRecipient(testCase)).to.throw();
    });
  }
});
