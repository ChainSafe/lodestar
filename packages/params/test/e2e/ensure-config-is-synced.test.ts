import {expect} from "chai";
import axios from "axios";
import {createIBeaconPreset} from "../../src/utils";
import * as mainnet from "../../src/presets/mainnet";
import * as minimal from "../../src/presets/minimal";
import {ForkName} from "../../src";
import {loadConfigYaml} from "../yaml";

// Not e2e, but slow. Run with e2e tests

async function downloadRemoteConfig(preset: "mainnet" | "minimal", commit: string): Promise<Record<string, unknown>> {
  const urlByFork: Record<ForkName, string> = {
    [ForkName.phase0]: `https://raw.githubusercontent.com/ethereum/eth2.0-specs/${commit}/presets/${preset}/phase0.yaml`,
    [ForkName.altair]: `https://raw.githubusercontent.com/ethereum/eth2.0-specs/${commit}/presets/${preset}/altair.yaml`,
    [ForkName.bellatrix]: `https://raw.githubusercontent.com/ethereum/eth2.0-specs/${commit}/presets/${preset}/bellatrix.yaml`,
  };

  const downloadedParams = await Promise.all(
    Object.values(urlByFork).map((url) =>
      axios({url, timeout: 30 * 1000}).then((response) => loadConfigYaml(response.data))
    )
  );

  // Merge all the fetched yamls for the different forks
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const configParams = Object.assign(...((downloadedParams as unknown) as [input: Record<string, unknown>]));

  return createIBeaconPreset(configParams);
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
