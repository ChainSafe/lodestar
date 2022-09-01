import {ICliCommandOptions} from "../util/index.js";

export type WSSOptions = {
  checkpointSyncUrl?: string;
  wssCheckpoint?: string;
};

export interface IWSSArgs {
  checkpointSyncUrl: string;
  checkpointState?: string;
  wssCheckpoint: string;
}

export const wssOptions: ICliCommandOptions<IWSSArgs> = {
  checkpointSyncUrl: {
    description:
      "Server url hosting Beacon Node APIs to fetch weak subjectivity state. Fetch latest finalized by default, else set --wssCheckpoint",
    type: "string",
    group: "weak subjectivity",
  },

  checkpointState: {
    description: "Set a checkpoint state to start syncing from",
    type: "string",
    group: "weak subjectivity",
  },
  wssCheckpoint: {
    description:
      "Start beacon node off a state at the provided weak subjectivity checkpoint, to be supplied in <blockRoot>:<epoch> format. For example, 0x1234:100 will sync and start off from the weakSubjectivity state at checkpoint of epoch 100 with block root 0x1234.",
    type: "string",
    group: "weak subjectivity",
  },
};
