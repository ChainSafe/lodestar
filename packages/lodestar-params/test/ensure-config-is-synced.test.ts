import {expect} from "chai";
import axios from "axios";
import {loadConfigYaml} from "../src/utils";
import * as mainnet from "../src/presets/mainnet";
import * as minimal from "../src/presets/minimal";

async function downloadRemoteConfig(
  preset: "mainnet" | "minimal",
  commit: string,
  phase: "0" | "1" = "0"
): Promise<Record<string, unknown>> {
  const fileUrl = `https://raw.githubusercontent.com/ethereum/eth2.0-specs/${commit}/configs/${preset}/phase${phase}.yaml`;
  const res = await axios({url: fileUrl, timeout: 30 * 1000});
  return loadConfigYaml(res.data);
}

describe("Ensure config is synced", function () {
  this.timeout(60 * 1000);

  it("phase0 mainnet", async function () {
    const remoteConfig = await downloadRemoteConfig("mainnet", mainnet.commit);
    expect(mainnet.phase0Yaml).to.deep.equal(remoteConfig);
  });

  it("phase0 minimal", async function () {
    const remoteConfig = await downloadRemoteConfig("minimal", minimal.commit);
    expect(minimal.phase0Yaml).to.deep.equal(remoteConfig);
  });

  it("phase1 mainnet", async function () {
    const remoteConfig = await downloadRemoteConfig("mainnet", mainnet.commit, "1");
    expect(mainnet.phase1Yaml).to.deep.equal(remoteConfig);
  });

  it("phase1 minimal", async function () {
    const remoteConfig = await downloadRemoteConfig("minimal", minimal.commit, "1");
    expect(minimal.phase1Yaml).to.deep.equal(remoteConfig);
  });
});
