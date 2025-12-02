import {PresetName, setActivePreset} from "@lodestar/params/setPreset";

// Set minimal
if (process.env.LODESTAR_PRESET === undefined) {
  process.env.LODESTAR_PRESET = "minimal";
}

// Override FIELD_ELEMENTS_PER_BLOB if its a dev run, mostly to distinguish from
// spec runs
if (process.env.LODESTAR_PRESET === "minimal") {
  setActivePreset(PresetName.minimal, {FIELD_ELEMENTS_PER_BLOB: 4096});
}
