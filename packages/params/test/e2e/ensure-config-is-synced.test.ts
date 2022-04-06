import {expect} from "chai";
import axios from "axios";
import * as mainnet from "../../src/presets/mainnet";
import * as minimal from "../../src/presets/minimal";
import {ForkName, BeaconPreset} from "../../src";
import {loadConfigYaml} from "../yaml.js";

// Not e2e, but slow. Run with e2e tests

describe("Ensure config is synced", function () {
  this.timeout(60 * 1000);

  it("mainnet", async function () {
    const remotePreset = await downloadRemoteConfig("mainnet", mainnet.commit);
    assertCorrectPreset({...mainnet.preset}, remotePreset);
  });

  it("minimal", async function () {
    const remotePreset = await downloadRemoteConfig("minimal", minimal.commit);
    assertCorrectPreset({...minimal.preset}, remotePreset);
  });
});

function assertCorrectPreset(localPreset: BeaconPreset, remotePreset: BeaconPreset): void {
  // Check each key for better debuggability
  for (const key of Object.keys(remotePreset) as (keyof BeaconPreset)[]) {
    expect(localPreset[key]).to.equal(remotePreset[key], `Wrong ${key} value`);
  }

  expect(localPreset).to.deep.equal(remotePreset);
}

async function downloadRemoteConfig(preset: "mainnet" | "minimal", commit: string): Promise<BeaconPreset> {
  const urlByFork: Record<ForkName, string> = {
    [ForkName.phase0]: `https://raw.githubusercontent.com/ethereum/consensus-specs/${commit}/presets/${preset}/phase0.yaml`,
    [ForkName.altair]: `https://raw.githubusercontent.com/ethereum/consensus-specs/${commit}/presets/${preset}/altair.yaml`,
    [ForkName.bellatrix]: `https://raw.githubusercontent.com/ethereum/consensus-specs/${commit}/presets/${preset}/bellatrix.yaml`,
  };

  const downloadedParams = await Promise.all(
    Object.values(urlByFork).map((url) =>
      axios({url, timeout: 30 * 1000}).then((response) => loadConfigYaml(response.data))
    )
  );

  // Merge all the fetched yamls for the different forks
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const beaconPresetRaw: Record<string, unknown> = Object.assign(
    ...((downloadedParams as unknown) as [input: Record<string, unknown>])
  );

  // As of December 2021 the presets don't include any hex strings
  const beaconPreset = {} as BeaconPreset;
  for (const key of Object.keys(beaconPresetRaw)) {
    beaconPreset[key as keyof BeaconPreset] = parseInt(beaconPresetRaw[key] as string, 10);
  }

  return beaconPreset;
}
