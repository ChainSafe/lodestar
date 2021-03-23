import {expect} from "chai";
import axios from "axios";
import {createIBeaconParams, loadConfigYaml} from "../src/utils";
import * as mainnet from "../src/presets/mainnet";
import * as minimal from "../src/presets/minimal";

async function downloadRemoteConfig(preset: "mainnet" | "minimal", commit: string): Promise<Record<string, unknown>> {
  const phase0Url = `https://raw.githubusercontent.com/ethereum/eth2.0-specs/${commit}/configs/${preset}/phase0.yaml`;
  const lightclientUrl = `https://raw.githubusercontent.com/ethereum/eth2.0-specs/${commit}/configs/${preset}/lightclient_patch.yaml`;
  const phase1Url = `https://raw.githubusercontent.com/ethereum/eth2.0-specs/${commit}/configs/${preset}/phase1.yaml`;
  const phase0Res = await axios({url: phase0Url, timeout: 30 * 1000});
  const lightclientRes = await axios({url: lightclientUrl, timeout: 30 * 1000});
  const phase1Res = await axios({url: phase1Url, timeout: 30 * 1000});
  return createIBeaconParams({
    ...loadConfigYaml(phase0Res.data),
    ...loadConfigYaml(lightclientRes.data),
    ...loadConfigYaml(phase1Res.data),
  });
}

describe("Ensure config is synced", function () {
  this.timeout(60 * 1000);

  // TODO: Remove items from this list as the specs are updated
  // Items added here are intentionally either not added, or are different
  // eslint-disable-next-line prettier/prettier
  const blacklist = [
    "LIGHTCLIENT_PATCH_FORK_SLOT",
    "LIGHTCLIENT_PATCH_FORK_VERSION",
    "HF1_INACTIVITY_PENALTY_QUOTIENT",
    "HF1_MIN_SLASHING_PENALTY_QUOTIENT",
    "HF1_PROPORTIONAL_SLASHING_MULTIPLIER",
    "PHASE_1_FORK_SLOT",
  ];

  it("mainnet", async function () {
    const remoteParams = await downloadRemoteConfig("mainnet", mainnet.commit);
    const localParams = {...mainnet.params};
    for (const param of blacklist) {
      delete remoteParams[param];
      delete (localParams as Record<string, unknown>)[param];
    }
    expect(localParams).to.deep.equal(remoteParams);
  });

  it("minimal", async function () {
    const remoteParams = await downloadRemoteConfig("minimal", minimal.commit);
    const localParams = {...minimal.params};
    for (const param of blacklist) {
      delete remoteParams[param];
      delete (localParams as Record<string, unknown>)[param];
    }
    expect(localParams).to.deep.equal(remoteParams);
  });
});
