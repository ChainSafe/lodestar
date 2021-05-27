import {ACTIVE_PRESET, GENESIS_EPOCH, ForkName, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {Slot, allForks, Version, ssz} from "@chainsafe/lodestar-types";
import {IBeaconConfig, IChainConfig, IForkConfig, IForkInfo} from "./interface";

export * from "./interface";

export function createIChainConfig(config?: Partial<IChainConfig>): IChainConfig {
  config = config ?? {};
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-member-access
  const presetConfig = require(`./presets/${ACTIVE_PRESET}`).config as IChainConfig;
  const outConfig = {
    ...presetConfig,
    ...config,
  };
  if (outConfig.PRESET_BASE !== ACTIVE_PRESET) {
    throw new Error(
      `Can only create a config for the active preset: active=${ACTIVE_PRESET} PRESET_BASE=${outConfig.PRESET_BASE}`
    );
  }
  return outConfig;
}

export function createIForkConfig(config: IChainConfig): IForkConfig {
  const phase0 = {name: ForkName.phase0, epoch: GENESIS_EPOCH, version: config.GENESIS_FORK_VERSION};
  const altair = {name: ForkName.altair, epoch: config.ALTAIR_FORK_EPOCH, version: config.ALTAIR_FORK_VERSION};

  /** Forks in order order of occurence, `phase0` first */
  // Note: Downstream code relies on proper ordering.
  const forks = {phase0, altair};

  // Prevents allocating an array on every getForkInfo() call
  const forksDescendingEpochOrder = Object.values(forks).reverse();

  return {
    forks,

    // Fork convenience methods
    getForkInfo(slot: Slot): IForkInfo {
      const epoch = Math.floor(slot / SLOTS_PER_EPOCH);
      // NOTE: forks must be sorted by descending epoch, latest fork first
      for (const fork of forksDescendingEpochOrder) {
        if (epoch >= fork.epoch) return fork;
      }
      return phase0;
    },
    getForkName(slot: Slot): ForkName {
      return this.getForkInfo(slot).name;
    },
    getForkVersion(slot: Slot): Version {
      return this.getForkInfo(slot).version;
    },
    getForkTypes(slot: Slot): allForks.AllForksSSZTypes {
      return ssz.allForks[this.getForkName(slot)];
    },
  };
}

export function createIBeaconConfig(config: IChainConfig): IBeaconConfig {
  return {
    ...config,
    ...createIForkConfig(config),
  };
}
