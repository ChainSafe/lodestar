import {expect} from "chai";
import {ssz} from "../../src";

it("should calculate correct minSize and maxSize", () => {
  const minSize = ssz.phase0.BeaconState.minSize();
  const maxSize = ssz.phase0.BeaconState.maxSize();
  // https://gist.github.com/protolambda/db75c7faa1e94f2464787a480e5d613e
  expect(minSize).to.be.equal(2687377);
  expect(maxSize).to.be.equal(141837543039377);
});
