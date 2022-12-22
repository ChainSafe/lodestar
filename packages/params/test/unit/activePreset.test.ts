import {expect} from "chai";
import {mainnetPreset} from "../../src/presets/mainnet.js";
import {minimalPreset} from "../../src/presets/minimal.js";
import {gnosisPreset as gnosisParams} from "../../src/presets/gnosis.js";
import {ACTIVE_PRESET, PresetName} from "../../src/index.js";
import {setActivePreset} from "../../src/setPreset.js";
import {setActivePreset as setActivePresetLib} from "../../src/setPreset.js";

describe("active preset", async () => {
  const exports = (await import("../../src/index.js")) as Record<string, unknown>;
  const params = {
    [PresetName.mainnet]: mainnetPreset,
    [PresetName.minimal]: minimalPreset,
    [PresetName.gnosis]: gnosisParams,
  };

  it("Active preset should be set to the correct value", () => {
    if (process.env.LODESTAR_PRESET) {
      expect(ACTIVE_PRESET).to.equal(
        process.env.LODESTAR_PRESET,
        "process.env.LODESTAR_PRESET must equal ACTIVE_PRESET"
      );
    } else {
      expect(ACTIVE_PRESET).to.equal(PresetName.mainnet, "Default preset must be mainnet");
    }
  });

  it("Constants should be set to the correct value", () => {
    for (const [k, v] of Object.entries(params[ACTIVE_PRESET])) {
      expect(exports[k]).to.deep.equal(v);
    }
  });

  it("Should not allow to change preset", () => {
    expect(() => {
      // I'm not sure if mocha is requiring from src or lib. Each file has different state.
      // To ensure this throws, call setActivePreset on both the src and lib file.
      setActivePreset(PresetName.minimal);
      setActivePresetLib(PresetName.minimal);
    }).to.throw();
  });
});
