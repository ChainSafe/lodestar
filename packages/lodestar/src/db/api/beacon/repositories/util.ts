import {SignedBeaconBlock} from "@chainsafe/lodestar-types";

export function isEligibleBlock(
  signedBlock: SignedBeaconBlock,
  step: number,
  safeLowerLimit: number | Buffer): boolean {
  if (step > 0 && typeof safeLowerLimit === "number") {
    return signedBlock.message.slot >= safeLowerLimit && (signedBlock.message.slot - safeLowerLimit) % step === 0;
  } else {
    return true;
  }
}