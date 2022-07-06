import {RunnerType} from "../utils/types.js";
import {specTestIterator} from "../utils/specTestIterator.js";
import {blsTestRunner} from "./bls.js";
import {sszGeneric} from "./ssz_generic.js";

/* eslint-disable @typescript-eslint/naming-convention */

specTestIterator("general", {
  bls: {type: RunnerType.default, fn: blsTestRunner},
  ssz_generic: {type: RunnerType.custom, fn: sszGeneric},
});
