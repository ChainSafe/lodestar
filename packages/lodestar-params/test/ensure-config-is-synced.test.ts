import {expect} from "chai";
import fetch from "node-fetch";
import {loadConfigYaml} from "../src/utils";
import {yaml as mainnetYaml} from "../src/presets/mainnet";
import {yaml as minimalYaml} from "../src/presets/minimal";

const commit = "1005b5baf8c043982b9a72282996311f9c194569";

async function downloadRemoteConfig(preset: "mainnet" | "minimal"): Promise<Record<string, unknown>> {
  const fileUrl = `https://raw.githubusercontent.com/ethereum/eth2.0-specs/${commit}/configs/${preset}/phase0.yaml`;
  const configRaw = await fetch(fileUrl).then((res) => res.text());
  return loadConfigYaml(configRaw);
}

describe("Ensure config is synced", function () {
  this.timeout(60 * 1000);

  it("mainnet", async function () {
    const remoteConfig = await downloadRemoteConfig("mainnet");
    expect(mainnetYaml).to.deep.equal(remoteConfig);
  });

  it("minimal", async function () {
    const remoteConfig = await downloadRemoteConfig("minimal");
    expect(minimalYaml).to.deep.equal(remoteConfig);
  });
});
