export * from "./primitive/sszTypes.js";
export {ssz as phase0} from "./phase0/index.js";
export {ssz as altair} from "./altair/index.js";
export {ssz as bellatrix} from "./bellatrix/index.js";

import {ssz as allForksSsz} from "./allForks/index.js";
export const allForks = allForksSsz.allForks;
