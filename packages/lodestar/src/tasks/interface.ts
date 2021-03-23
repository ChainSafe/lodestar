/**
 * @module chores
 */

import {Slot} from "@chainsafe/lodestar-types";

export interface ITask {
  run(): Promise<void>;
}

export interface ITaskService {
  getBlockArchivingStatus: () => IArchivingStatus;
  waitForBlockArchiver: () => Promise<void>;
}

export interface IArchivingStatus {
  lastFinalizedSlot: Slot;
  finalizingSlot: Slot | null;
}
