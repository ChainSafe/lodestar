import {routes} from "@lodestar/api";
import {chainConfigToJson, IChainConfig, specValuesToJson} from "@lodestar/config";
import {activePreset, presetToJson} from "@lodestar/params";
import {ApiModules} from "../types.js";
import {specConstants} from "./constants.js";

/**
 * Retrieve specification configuration used on this node.  The configuration should include:
 *  - Constants for all hard forks known by the beacon node, for example the
 *    [phase 0](https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/beacon-chain.md#constants) and
 *    [altair](https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/altair/beacon-chain.md#constants) values
 *  - Presets for all hard forks supplied to the beacon node, for example the
 *    [phase 0](https://github.com/ethereum/consensus-specs/blob/v1.1.10/presets/mainnet/phase0.yaml) and
 *    [altair](https://github.com/ethereum/consensus.0-specs/blob/v1.1.10/presets/mainnet/altair.yaml) values
 *  - Configuration for the beacon node, for example the [mainnet](https://github.com/ethereum/consensus-specs/blob/v1.1.10/configs/mainnet.yaml) values
 */
export function renderJsonSpec(config: IChainConfig): Record<string, string> {
  const configJson = chainConfigToJson(config);
  const presetJson = presetToJson(activePreset);
  const constantsJson = specValuesToJson(specConstants);
  return {...configJson, ...presetJson, ...constantsJson};
}

export function getConfigApi({config}: Pick<ApiModules, "config">): routes.config.Api {
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
        data: renderJsonSpec(config),
      };
    },
  };
}
