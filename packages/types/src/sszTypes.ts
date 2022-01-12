export * from "./primitive/sszTypes";
export {ssz as phase0} from "./phase0";
export {ssz as altair} from "./altair";
export {ssz as bellatrix} from "./bellatrix";

import {ssz as allForksSsz} from "./allForks";
export const allForks = allForksSsz.allForks;
