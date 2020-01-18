import {assert, expect} from "chai";
import fs from "fs";
import defaults, { IBeaconNodeOptions } from "@chainsafe/lodestar/src/node/options";
import { writeTomlConfig, getTomlConfig } from "../../../../src/lodestar/util/file";
import { BeaconNodeOptions } from "../../../../src/lodestar/node/options";

describe("util/file", function() {
  const testFilePath = "keys/toml/test_config.toml";

  after(() => {
    fs.unlinkSync(testFilePath);
  });

  it("@chainsafe/eth2.0-config", () => {
    writeTomlConfig(testFilePath);
    assert.isTrue(fs.existsSync(testFilePath));
  });

  it("should generate config from toml file", () => {
    const config = getTomlConfig<Partial<IBeaconNodeOptions>>(testFilePath, BeaconNodeOptions);
    expect(config).to.not.be.undefined;
    assert.equal(config.chain.name, defaults.chain.name);
    assert.equal(config.db.name, defaults.db.name);
    assert.equal(config.eth1.depositContract.address, defaults.eth1.depositContract.address);
  });
});
