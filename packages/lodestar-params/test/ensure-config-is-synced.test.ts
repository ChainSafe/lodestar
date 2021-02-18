import {expect} from "chai";
import axios from "axios";
import {createIBeaconParams, loadConfigYaml} from "../src/utils";
import * as mainnet from "../src/presets/mainnet";
import * as minimal from "../src/presets/minimal";

async function downloadRemoteConfig(preset: "mainnet" | "minimal", commit: string): Promise<Record<string, unknown>> {
  const phase0Url = `https://raw.githubusercontent.com/ethereum/eth2.0-specs/${commit}/configs/${preset}/phase0.yaml`;
  const phase0Res = await axios({url: phase0Url, timeout: 30 * 1000});
  return createIBeaconParams({...loadConfigYaml(phase0Res.data)});
}

describe("Ensure config is synced", function () {
  this.timeout(60 * 1000);

  it("mainnet", async function () {
    const remoteConfig = await downloadRemoteConfig("mainnet", mainnet.commit);
    expect(mainnet.params).to.deep.equal(remoteConfig);
  });

  it("minimal", async function () {
    const remoteConfig = await downloadRemoteConfig("minimal", minimal.commit);
    expect(minimal.params).to.deep.equal(remoteConfig);
  });
});
