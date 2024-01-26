import {describe, it, expect, beforeAll} from "vitest";
import {mainnetPreset} from "../../src/presets/mainnet.js";
import {minimalPreset} from "../../src/presets/minimal.js";
import {gnosisPreset as gnosisParams} from "../../src/presets/gnosis.js";
import {ACTIVE_PRESET, PresetName} from "../../src/index.js";
import {setActivePreset} from "../../src/setPreset.js";
import {setActivePreset as setActivePresetLib} from "../../src/setPreset.js";

describe("active preset", () => {
  let exports: Record<string, unknown>;

  beforeAll(async () => {
    exports = (await import("../../src/index.js")) as Record<string, unknown>;
  });

  const params = {
    [PresetName.mainnet]: mainnetPreset,
    [PresetName.minimal]: minimalPreset,
    [PresetName.gnosis]: gnosisParams,
  };

  it("Active preset should be set to the correct value", () => {
    if (process.env.LODESTAR_PRESET) {
      expect(ACTIVE_PRESET).toBe(process.env.LODESTAR_PRESET);
    } else {
      expect(ACTIVE_PRESET).toBe(PresetName.mainnet);
    }
  });

  it("Constants should be set to the correct value", () => {
    for (const [k, v] of Object.entries(params[ACTIVE_PRESET])) {
      expect(exports[k]).toEqual(v);
    }
  });

  it("Should not allow to change preset", () => {
    expect(() => {
      setActivePreset(PresetName.minimal);
      setActivePresetLib(PresetName.minimal);
    }).toThrow();
  });
});
