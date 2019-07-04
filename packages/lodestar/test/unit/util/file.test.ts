import {expect, assert} from "chai";
import fs from "fs";
import {writeTomlConfig, getTomlConfig, ensureDirectoryExistence} from "../../../util/file";
import defaults from "../../../node/defaults";

describe("util/file", function() {
  const testFilePath = "keys/toml/test_config.toml";

  after(() => {
    fs.unlinkSync(testFilePath);
  });

  it("should create directory needed for file writes", () => {
    assert.isTrue(ensureDirectoryExistence(testFilePath));
  });

  it("should return true for existing directory", () => {
    assert.isTrue(ensureDirectoryExistence("src"));
  });

  it("should write toml config", () => {
    writeTomlConfig(testFilePath);
    assert.isTrue(fs.existsSync(testFilePath));
  });

  it("should generate config from toml file", () => {
    const config = getTomlConfig(testFilePath);
    expect(config).to.not.be.undefined;
    assert.equal(config.chain.chain, defaults.chain.chain);
    assert.equal(config.db.name, defaults.db.name);
    assert.equal(config.eth1.depositContract.address, defaults.eth1.depositContract.address);
    assert.equal(config.rpc.port, defaults.rpc.port);
  });
});
