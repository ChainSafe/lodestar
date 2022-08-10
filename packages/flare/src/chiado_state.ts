import {expect} from "chai";
import fs from "node:fs";
import {ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";

const statePlaybooks = readState("genesis.ssz");

console.log(toHex(statePlaybooks.hashTreeRoot()));

// console.log({
//   statePlaybooks: statePlaybooks.toValue(),
//   statePrebuiltClient: statePrebuiltClient.toValue(),
// });

// fs.writeFileSync(
//   "statePlaybooks.json",
//   JSON.stringify(ssz.phase0.BeaconState.toJson(statePlaybooks.toValue()), null, 2)
// );
// fs.writeFileSync(
//   "statePrebuiltClient.json",
//   JSON.stringify(ssz.phase0.BeaconState.toJson(statePrebuiltClient.toValue()), null, 2)
// );

// it("state", () => {
//   console.log("Comparing");
//   expect(ssz.phase0.BeaconState.toJson(statePlaybooks.toValue())).to.deep.equal(
//     ssz.phase0.BeaconState.toJson(statePrebuiltClient.toValue())
//   );
//   console.log("Compared");
// });

function readState(filepath: string) {
  return ssz.phase0.BeaconState.deserializeToViewDU(fs.readFileSync(filepath));
}
