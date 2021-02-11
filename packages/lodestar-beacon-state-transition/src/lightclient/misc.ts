import {ValidatorFlag} from "@chainsafe/lodestar-types";

export function addValidatorFlags(flags: ValidatorFlag, add: ValidatorFlag): ValidatorFlag {
  return flags | add;
}

export function hasValidatorFlags(flags: ValidatorFlag, has: ValidatorFlag): boolean {
  return (flags & has) == has;
}
