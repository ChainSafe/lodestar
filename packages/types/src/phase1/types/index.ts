export * from "./primitive";
export * from "./shard";
export * from "./misc";
export * from "./custody";
export * from "./beacon";

// Re-export primitives
export * from "../../primitive/types";
// Re-export phase0 unchanging
// TODO reorganize phase0 files
//export * from "../../phase0/types/misc";
// Re-export altair unchanging
export * from "../../altair/types/sync";
export * from "../../altair/types/committee";
