import axios from "axios";
import {describe, expect, it, vi} from "vitest";
import {BeaconPreset, ForkName} from "../../src/index.js";
import {mainnetPreset} from "../../src/presets/mainnet.js";
import {minimalPreset} from "../../src/presets/minimal.js";
import {loadConfigYaml} from "../yaml.js";

// Not e2e, but slow. Run with e2e tests

/** https://github.com/ethereum/consensus-specs/releases */
const specConfigCommit = "v1.7.0-alpha.1";
/**
 * Fields that we filter from local config when doing comparison.
 * Ideally this should be empty as it is not spec compliant
 */
const ignoredLocalPresetFields: (keyof BeaconPreset)[] = [];

describe("Ensure config is synced", () => {
  vi.setConfig({testTimeout: 60 * 1000});

  it("mainnet", async () => {
    const remotePreset = await downloadRemoteConfig("mainnet", specConfigCommit);
    assertCorrectPreset({...mainnetPreset}, remotePreset);
  });

  it("minimal", async () => {
    const remotePreset = await downloadRemoteConfig("minimal", specConfigCommit);
    assertCorrectPreset({...minimalPreset}, remotePreset);
  });
});

function assertCorrectPreset(localPreset: BeaconPreset, remotePreset: BeaconPreset): void {
  const filteredLocalPreset: Partial<BeaconPreset> = Object.keys(localPreset)
    .filter((key) => !ignoredLocalPresetFields.includes(key as keyof BeaconPreset))
    .reduce(
      (acc, key) => {
        acc[key as keyof BeaconPreset] = localPreset[key as keyof BeaconPreset];
        return acc;
      },
      {} as Partial<BeaconPreset>
    );

  // Check each key for better debuggability
  for (const key of Object.keys(remotePreset) as (keyof BeaconPreset)[]) {
    const localValue = filteredLocalPreset[key];
    const remoteValue = remotePreset[key];

    expect(localValue).toBeWithMessage(remoteValue, `${key} does not match ${localValue} != ${remoteValue}`);
  }

  expect(filteredLocalPreset).toEqual(remotePreset);
}

async function downloadRemoteConfig(preset: "mainnet" | "minimal", commit: string): Promise<BeaconPreset> {
  const downloadedParams: Record<string, unknown>[] = [];

  for (const forkName of Object.values(ForkName)) {
    const response = await axios({
      url: `https://raw.githubusercontent.com/ethereum/consensus-specs/${commit}/presets/${preset}/${forkName}.yaml`,
      timeout: 30 * 1000,
    });
    downloadedParams.push(loadConfigYaml(response.data));

    // We get error `Request failed with status code 429`
    // which is `Too Many Request` so we added a bit delay between each request
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // Merge all the fetched yamls for the different forks
  const beaconPresetRaw: Record<string, unknown> = Object.assign(
    ...(downloadedParams as unknown as [input: Record<string, unknown>])
  );

  // As of December 2021 the presets don't include any hex strings
  const beaconPreset = {} as BeaconPreset;
  for (const key of Object.keys(beaconPresetRaw)) {
    beaconPreset[key as keyof BeaconPreset] = parseInt(beaconPresetRaw[key] as string, 10);
  }

  return beaconPreset;
}
