/* eslint-disable @typescript-eslint/naming-convention */
import path from "node:path";
import {fileURLToPath} from "node:url";
import {expect} from "chai";
import {routes} from "@lodestar/api";

import {parseProposerConfig} from "../../../src/util/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const testValue = {
  proposerConfig: {
    "0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c": {
      graffiti: "graffiti",
      strictFeeRecipientCheck: true,
      feeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      builder: {
        gasLimit: 30000000,
        selection: undefined,
      },
    },
    "0xa4855c83d868f772a579133d9f23818008417b743e8447e235d8eb78b1d8f8a9f63f98c551beb7de254400f89592314d": {
      graffiti: undefined,
      strictFeeRecipientCheck: undefined,
      feeRecipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      builder: {
        gasLimit: 35000000,
        selection: routes.validator.BuilderSelection.MaxProfit,
      },
    },
  },
  defaultConfig: {
    graffiti: "default graffiti",
    strictFeeRecipientCheck: true,
    feeRecipient: "0xcccccccccccccccccccccccccccccccccccccccc",
    builder: {
      gasLimit: 30000000,
      selection: routes.validator.BuilderSelection.BuilderAlways,
    },
  },
};

describe("validator / valid Proposer", () => {
  it("parse Valid proposer", () => {
    expect(parseProposerConfig(path.join(__dirname, "./proposerConfigs/validData.yaml"))).to.be.deep.equal(testValue);
  });
});

describe("validator / invalid Proposer", () => {
  it("should throw error", () => {
    expect(() => parseProposerConfig(path.join(__dirname, "./proposerConfigs/invalidData.yaml"))).to.throw();
  });
});
