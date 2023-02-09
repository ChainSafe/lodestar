export * from "./primitive/sszTypes.js";
export {ssz as phase0} from "./phase0/index.js";
export {ssz as altair} from "./altair/index.js";
export {ssz as bellatrix} from "./bellatrix/index.js";
export {ssz as capella} from "./capella/index.js";
export {ssz as deneb} from "./deneb/index.js";

import {ssz as allForksSsz} from "./allForks/index.js";
export const allForks = allForksSsz.allForks;
export const allForksBlinded = allForksSsz.allForksBlinded;
export const allForksExecution = allForksSsz.allForksExecution;
export const allForksBlobs = allForksSsz.allForksBlobs;
export const allForksLightClient = allForksSsz.allForksLightClient;
