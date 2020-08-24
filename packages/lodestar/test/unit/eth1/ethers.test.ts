import "mocha";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {Eth1Provider} from "../../../src/eth1";
import eth1Options from "../../../src/eth1/options";

describe("eth1 / Eth1Provider", () => {
  it("Should initialize with a correct address", () => {
    new Eth1Provider(config, eth1Options);
  });

  it("Should throw with an invalid address", () => {
    const badConfig = {
      ...config,
      params: {
        ...config.params,
        DEPOSIT_CONTRACT_ADDRESS: Buffer.from(""),
      },
    };
    expect(() => new Eth1Provider(badConfig, eth1Options)).to.throw();
  });
});
