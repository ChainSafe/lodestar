export * from "./primitive/types.js";
export {ts as phase0} from "./phase0/index.js";
export {ts as altair} from "./altair/index.js";
export {ts as bellatrix} from "./bellatrix/index.js";

export {ts as allForks} from "./allForks/index.js";

/** Common non-spec type to represent roots as strings */
export type RootHex = string;
