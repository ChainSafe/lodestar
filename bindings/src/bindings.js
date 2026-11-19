import {join} from "node:path";
import {requireNapiLibrary} from "@chainsafe/zapi";

// Consensus presets are compiled into the addon, so there is one binary per preset.
// The selection mirrors `ACTIVE_PRESET` in `@lodestar/params`.
const presets = ["mainnet", "minimal", "gnosis"];
const preset = process.env.LODESTAR_PRESET;

const bindings = requireNapiLibrary(join(import.meta.dirname, ".."), {
  variant: preset !== undefined && presets.includes(preset) ? preset : "mainnet",
});

export default bindings;
