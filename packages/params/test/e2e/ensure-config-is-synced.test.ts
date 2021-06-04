import {expect} from "chai";
import axios from "axios";
import {createIBeaconPreset} from "../../src/utils";
import * as mainnet from "../../src/presets/mainnet";
import * as minimal from "../../src/presets/minimal";
import {loadConfigYaml} from "../yaml";

// Not e2e, but slow. Run with e2e tests

async function downloadRemoteConfig(preset: "mainnet" | "minimal", commit: string): Promise<Record<string, unknown>> {
  const phase0Url = `https://raw.githubusercontent.com/ethereum/eth2.0-specs/${commit}/presets/${preset}/phase0.yaml`;
  const altairUrl = `https://raw.githubusercontent.com/ethereum/eth2.0-specs/${commit}/presets/${preset}/altair.yaml`;
  const phase0Res = await axios({url: phase0Url, timeout: 30 * 1000});
  const altairRes = await axios({url: altairUrl, timeout: 30 * 1000});
  return createIBeaconPreset({
    ...loadConfigYaml(phase0Res.data),
    ...loadConfigYaml(altairRes.data),
  });
}

describe("Ensure config is synced", function () {
  this.timeout(60 * 1000);

  // TODO: Remove items from this list as the specs are updated
  // Items added here are intentionally either not added, or are different
  // eslint-disable-next-line prettier/prettier
  const blacklist: string[] = [
    "SYNC_COMMITTEE_SIZE"
  ];

  it("mainnet", async function () {
    const remotePreset = await downloadRemoteConfig("mainnet", mainnet.commit);
    const localPreset = {...mainnet.preset};
    for (const param of blacklist) {
      delete remotePreset[param];
      delete (localPreset as Record<string, unknown>)[param];
    }
    expect(localPreset).to.deep.equal(remotePreset);
  });

  it("minimal", async function () {
    const remotePreset = await downloadRemoteConfig("minimal", minimal.commit);
    const localPreset = {...minimal.preset};
    for (const param of blacklist) {
      delete remotePreset[param];
      delete (localPreset as Record<string, unknown>)[param];
    }
    expect(localPreset).to.deep.equal(remotePreset);
  });
});
