import {RunnerType} from "../utils/types";
import {specTestIterator} from "../utils/specTestIterator";
import {blsTestRunner} from "./bls";
import {sszGeneric} from "./ssz_generic";

/* eslint-disable @typescript-eslint/naming-convention */

specTestIterator("general", {
  bls: {type: RunnerType.default, fn: blsTestRunner},
  ssz_generic: {type: RunnerType.custom, fn: sszGeneric},
});
