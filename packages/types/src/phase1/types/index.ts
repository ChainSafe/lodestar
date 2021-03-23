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
// Re-export lightclient unchanging
export * from "../../lightclient/types/sync";
export * from "../../lightclient/types/committee";
