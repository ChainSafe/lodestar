import {routes} from "@chainsafe/lodestar-api";
import {chainConfigToJson} from "@chainsafe/lodestar-config";
import {activePreset, presetToJson} from "@chainsafe/lodestar-params";
import {ApiModules} from "../types";

export function getConfigApi({config}: Pick<ApiModules, "config">): routes.config.Api {
  // Retrieve specification configuration used on this node.  The configuration should include:
  //  - Constants for all hard forks known by the beacon node, for example the
  //    [phase 0](https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/beacon-chain.md#constants) and
  //    [altair](https://github.com/ethereum/eth2.0-specs/blob/dev/specs/altair/beacon-chain.md#constants) values
  //  - Presets for all hard forks supplied to the beacon node, for example the
  //    [phase 0](https://github.com/ethereum/eth2.0-specs/blob/dev/presets/mainnet/phase0.yaml) and
  //    [altair](https://github.com/ethereum/eth2.0-specs/blob/dev/presets/mainnet/altair.yaml) values
  //  - Configuration for the beacon node, for example the [mainnet](https://github.com/ethereum/eth2.0-specs/blob/dev/configs/mainnet.yaml) values

  let jsonSpec: Record<string, string> | null = null;
  function getJsonSpec(): Record<string, string> {
    // TODO: Include static constants exported in @chainsafe/lodestar-params (i.e. DOMAIN_BEACON_PROPOSER)
    const configJson = chainConfigToJson(config);
    const presetJson = presetToJson(activePreset);
    jsonSpec = {...configJson, ...presetJson};
    return jsonSpec;
  }

  return {
    async getForkSchedule() {
      const forkInfos = Object.values(config.forks);
      const forks = forkInfos.map((fi, ix) => ({
        previousVersion: ix === 0 ? fi.version : forkInfos[ix - 1].version,
        currentVersion: fi.version,
        epoch: fi.epoch,
      }));
      return {data: forks};
    },

    async getDepositContract() {
      return {
        data: {
          chainId: config.DEPOSIT_CHAIN_ID,
          address: config.DEPOSIT_CONTRACT_ADDRESS,
        },
      };
    },

    async getSpec() {
      return {
        data: getJsonSpec(),
      };
    },
  };
}
