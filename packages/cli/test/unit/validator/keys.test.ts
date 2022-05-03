import {expect} from "chai";
import sinon from "sinon";
import fs, {Dirent, Stats} from "node:fs";
import {resolveKeystorePaths} from "../../../src/cmds/validator/keys";
import {isVotingKeystore} from "../../../src/util";

describe("validator / keys / resolveKeystorePaths", () => {
  beforeEach(() => {
    sinon.stub(fs, "lstatSync").returns({isDirectory: () => true} as Stats);
  });

  it("should filter out deposit data files", function () {
    const keystoreFilename = "keystore-m_12381_3600_0_0_0-1642090404.json";
    const depositData = "deposit_data-1642090404.json";

    sinon.stub(fs, "readdirSync").callsFake(() => {
      return ([keystoreFilename, depositData] as unknown) as Dirent[];
    });

    const result = resolveKeystorePaths("dir");
    expect(result.length).to.equal(1);
    expect(result[0]).to.equal(`dir/${keystoreFilename}`);
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
