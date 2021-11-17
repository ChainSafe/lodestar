import {Slot} from "./primitive/types";

export * from "./primitive/types";
export {ts as phase0} from "./phase0";
export {ts as altair} from "./altair";
export {ts as merge} from "./merge";

export {ts as allForks} from "./allForks";

/** Common non-spec type to represent roots as strings */
export type RootHex = string;

/** This type helps response to beacon_block_by_range and beacon_block_by_root more efficiently */
export type P2pBlockResponse = {
  /** Deserialized data of allForks.SignedBeaconBlock */
  bytes: Buffer;
  slot: Slot;
};
