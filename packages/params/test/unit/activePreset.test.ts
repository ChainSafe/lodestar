import {preset as mainnetParams} from "../../src/presets/mainnet";
import {preset as minimalParams} from "../../src/presets/minimal";
import {ACTIVE_PRESET, PresetName, setActivePreset} from "../../src";
import {expect} from "chai";

describe("active preset", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const exports = require("../../src") as Record<string, unknown>;
  const params = {
    [PresetName.mainnet]: mainnetParams,
    [PresetName.minimal]: minimalParams,
  };

  after(() => {
    // reset preset to initial value
    setActivePreset(ACTIVE_PRESET);
  });

  it("setActivePreset should change exported params", () => {
    for (const presetName of [PresetName.mainnet, PresetName.minimal]) {
      setActivePreset(presetName);

      expect(exports.ACTIVE_PRESET).to.equal(presetName);
      for (const [k, v] of Object.entries(params[presetName])) {
        expect(exports[k]).to.deep.equal(v);
      }
    }
  });
});
