import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {expect} from "chai";

it("should calculate correct minSize and maxSize", () => {
  const minSize = config.types.BeaconState.minSize();
  const maxSize = config.types.BeaconState.maxSize();
  // https://gist.github.com/protolambda/db75c7faa1e94f2464787a480e5d613e
  expect(minSize).to.be.equal(2687377);
  expect(maxSize).to.be.equal(141837542965649);
});