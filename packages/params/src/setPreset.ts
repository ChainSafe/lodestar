import {PresetName} from "./presetName.js";
import {presetStatus} from "./presetStatus.js";

export {PresetName};

/**
 * The preset name currently exported by this library
 *
 * The `LODESTAR_PRESET` environment variable is used to select the active preset
 * If `LODESTAR_PRESET` is not set, the default is `mainnet`.
 *
 * The active preset can be manually overridden with `setActivePreset`
 */
export let userSelectedPreset: PresetName | null = null;

/**
 * Override the active preset
 *
 * WARNING: Lodestar libraries rely on preset values being _constant_, so the active preset must be set _before_ loading any other lodestar libraries.
 *
 * Only call this function if you _really_ know what you are doing.
 */
export function setActivePreset(presetName: PresetName): void {
  if (presetStatus.frozen) {
    throw Error(`Lodestar preset is already frozen. You must call setActivePreset() at the top of your
application entry point, before importing @chainsafe/lodestar-params, or any library that may import it.

\`\`\`
// index.ts
import {setActivePreset, PresetName} from "@chainsafe/lodestar-params/preset"
setActivePreset(PresetName.minimal)
// Now you can safely import from other paths and consume params
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params"
console.log({SLOTS_PER_EPOCH})
\`\`\`
`);
  }

  userSelectedPreset = presetName;
}
