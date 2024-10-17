import {ArchiveMode} from "./interface.js";

/**
 * Minimum number of epochs between single temp archived states
 * These states will be pruned once a new state is persisted
 */
export const PERSIST_TEMP_STATE_EVERY_EPOCHS = 32;

export const PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN = 256;

export const DEFAULT_ARCHIVE_MODE = ArchiveMode.Full;
