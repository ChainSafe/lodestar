import {ICliCommandOptions} from "../util";

export type WSSOptions =
  | {
      weakSubjectivityStateFile: string;
      weakSubjectivitySyncLatest: undefined;
      weakSubjectivityServerUrl: undefined;
      weakSubjectivityCheckpoint: string | undefined;
    }
  | {
      weakSubjectivityStateFile: undefined;
      weakSubjectivitySyncLatest: boolean;
      weakSubjectivityServerUrl: string;
      weakSubjectivityCheckpoint: string | undefined;
    };
export interface IWSSArgs {
  "weakSubjectivity.stateFile": string;
  "weakSubjectivity.syncLatest": boolean;
  "weakSubjectivity.checkpoint": string;
  "weakSubjectivity.serverUrl": string;
}

export function parseWSSArgs(args: IWSSArgs): WSSOptions | null {
  const {
    "weakSubjectivity.stateFile": weakSubjectivityStateFile,
    "weakSubjectivity.syncLatest": weakSubjectivitySyncLatest,
    "weakSubjectivity.checkpoint": weakSubjectivityCheckpoint,
    "weakSubjectivity.serverUrl": weakSubjectivityServerUrl,
  } = args;
  if (weakSubjectivityStateFile) {
    return {weakSubjectivityStateFile, weakSubjectivityCheckpoint} as WSSOptions;
  } else if (weakSubjectivitySyncLatest) {
    if (!weakSubjectivityServerUrl) {
      throw Error("Must set arg --weakSubjectivity.serverUrl for wss sync");
    }
    return {weakSubjectivitySyncLatest, weakSubjectivityServerUrl, weakSubjectivityCheckpoint} as WSSOptions;
  } else {
    return null;
  }
}

export const wssOptions: ICliCommandOptions<IWSSArgs> = {
  "weakSubjectivity.stateFile": {
    description: "Path or URL to download a weak subjectivity state file in ssz-encoded format",
    type: "string",
    group: "weakSubjectivity",
  },

  "weakSubjectivity.syncLatest": {
    description:
      "Sync and start from a weak subjectivity state at --weakSubjectivity.checkpoint (if provided, else fetches the latest finalized) via the --weakSubjectivity.serverUrl",
    type: "boolean",
    group: "weakSubjectivity",
  },

  "weakSubjectivity.checkpoint": {
    description:
      "To fetch and start beacon node off a state at the provided weakSubjectivity checkpoint, to be supplied in <blockRoot>:<epoch> format. For example, 0x1234:100 will sync and start off from the weakSubjectivity state at checkpoint of epoch 100 with block root 0x1234.",
    type: "string",
    group: "weakSubjectivity",
  },

  "weakSubjectivity.serverUrl": {
    description:
      "Pass in a server url hosting Beacon Node APIs from which to fetch weak subjectivity state, required in conjunction with --weakSubjectivity.syncLatest or --weakSubjectivity.checkpoint.",
    type: "string",
    group: "weakSubjectivity",
  },
};
