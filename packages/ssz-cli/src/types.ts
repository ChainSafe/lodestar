import {types as mainnetTypes} from "@chainsafe/eth2.0-ssz-types/lib/presets/mainnet";
import {types as minimalTypes} from "@chainsafe/eth2.0-ssz-types/lib/presets/minimal";

export const presets = {
  mainnet: mainnetTypes,
  minimal: minimalTypes,
} as const;

export type PresetName = keyof typeof presets;

export const presetNames: PresetName[] = Object.keys(presets) as PresetName[];

