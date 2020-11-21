import {expect} from "chai";
import axios from "axios";
import {loadConfigYaml} from "../src/utils";
import * as mainnet from "../src/presets/mainnet";
import * as minimal from "../src/presets/minimal";

async function downloadRemoteConfig(preset: "mainnet" | "minimal", commit: string): Promise<Record<string, unknown>> {
  const fileUrl = `https://raw.githubusercontent.com/ethereum/eth2.0-specs/${commit}/configs/${preset}/phase0.yaml`;
  const res = await axios({url: fileUrl, timeout: 30 * 1000});
  return loadConfigYaml(res.data);
}

describe("Ensure config is synced", function () {
  this.timeout(60 * 1000);

  it("mainnet", async function () {
    const remoteConfig = await downloadRemoteConfig("mainnet", mainnet.commit);
    expect(mainnet.yaml).to.deep.equal(remoteConfig);
  });

  it("minimal", async function () {
    const remoteConfig = await downloadRemoteConfig("minimal", minimal.commit);
    expect(minimal.yaml).to.deep.equal(remoteConfig);
  });
});
