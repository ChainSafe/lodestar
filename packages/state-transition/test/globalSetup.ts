import {setActivePreset, PresetName} from "@lodestar/params/setPreset";

export async function setup(): Promise<void> {
  process.env.NODE_ENV = "test";

  // Set minimal
  if (process.env.LODESTAR_PRESET === undefined) {
    process.env.LODESTAR_PRESET = "minimal";
  }

  // Override FIELD_ELEMENTS_PER_BLOB if its a dev run, mostly to distinguish from
  // spec runs
  if (process.env.LODESTAR_PRESET === "minimal" && process.env.DEV_RUN) {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    setActivePreset(PresetName.minimal, {FIELD_ELEMENTS_PER_BLOB: 4096});
  }
}

export async function teardown(): Promise<void> {
}
