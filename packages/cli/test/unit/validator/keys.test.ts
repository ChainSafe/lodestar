import fs, {Dirent, Stats} from "node:fs";
import {expect} from "chai";
import sinon from "sinon";
import {resolveKeystorePaths} from "../../../src/cmds/validator/keys.js";
import {isVotingKeystore} from "../../../src/util/index.js";

describe("validator / keys / resolveKeystorePaths", () => {
  beforeEach(() => {
    sinon.stub(fs, "lstatSync").returns({isDirectory: () => true} as Stats);
  });

  it("should filter out filenames that does not conform to format for keystore ", function () {
    const keystoreFilename = "keystore-m_12381_3600_0_0_0-1642090404.json";
    const depositData = "deposit_data-1642090404.json";
    const passwordTxt = "password.txt";
    const withoutExtensions = "withoutExtensions";
    const importedKeystore =
      "key_imported_0x97b1b00d3c1888b5715c2c88bf1df7b0ad715388079de211bdc153697b69b868c671af3b2d86c5cdfbade48d03888ab4.json";

    sinon.stub(fs, "readdirSync").callsFake(() => {
      return ([keystoreFilename, depositData, passwordTxt, withoutExtensions, importedKeystore] as unknown) as Dirent[];
    });

    const result = resolveKeystorePaths("dir");
    expect(result.length).to.equal(2);
    expect(result).to.deep.equal([`dir/${keystoreFilename}`, `dir/${importedKeystore}`]);
  });

  it("should read key voting files with accepted file names", function () {
    const keystoreFilenames = ["keystore-m_12381_3600_0_0_0-1642090404.json", "keystore-0.json", "keystore.json"];

    sinon.stub(fs, "readdirSync").callsFake(() => {
      return ([keystoreFilenames] as unknown) as Dirent[];
    });

    expect(keystoreFilenames.every(isVotingKeystore)).to.equal(true, "should read voting keystore file");
  });

  afterEach(() => {
    sinon.restore();
  });
});
