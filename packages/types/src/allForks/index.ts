export * from "./types.js";

// We have to use import->export because of the limitation in `@microsoft/api-extractor`
// which is used to bundle the package types
import * as ts from "./types.js";
import * as ssz from "./sszTypes.js";
export {ts, ssz};
