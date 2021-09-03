import {expect} from "chai";
import {ACTIVE_PRESET, PresetName} from "@chainsafe/lodestar-params";
import {ssz} from "../../src";

it("should calculate correct minSize and maxSize", () => {
  before("Must run with preset minimal", () => {
    expect(ACTIVE_PRESET).to.equal(PresetName.minimal);
  });

  const minSize = ssz.phase0.BeaconState.minSize();
  const maxSize = ssz.phase0.BeaconState.maxSize();
  // https://gist.github.com/protolambda/db75c7faa1e94f2464787a480e5d613e
  expect(minSize).to.be.equal(7057, "Wrong minSize");
  expect(maxSize).to.be.equal(141837537701009, "Wrong maxSize");
});
