import {assert} from "chai";
import fs from "fs";
import {ensureDirectoryExistence} from "../../../src/util/file";

describe("util/file", function() {
  const testFilePath = "keys/toml/test_config.toml";

  it("should create directory needed for file writes", () => {
    assert.isTrue(ensureDirectoryExistence(testFilePath));
  });

  it("should return true for existing directory", () => {
    assert.isTrue(ensureDirectoryExistence("src"));
  });

});
