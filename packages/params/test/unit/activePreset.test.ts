import {preset as mainnetParams} from "../../src/presets/mainnet";
import {preset as minimalParams} from "../../src/presets/minimal";
import {ACTIVE_PRESET, PresetName} from "../../src";
import {setActivePreset} from "../../src/setPreset";
import {setActivePreset as setActivePresetLib} from "../../setPreset";
import {expect} from "chai";

describe("active preset", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const exports = require("../../src") as Record<string, unknown>;
  const params = {
    [PresetName.mainnet]: mainnetParams,
    [PresetName.minimal]: minimalParams,
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
