import {ICliCommandOptions} from "../util/index.js";

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
  "wss.state": string;
  "wss.syncLatest": boolean;
  "wss.syncUrl": string;
  "wss.checkpoint": string;
}

export function parseWSSArgs(args: IWSSArgs): WSSOptions | null {
  const {
    "wss.state": weakSubjectivityStateFile,
    "wss.syncLatest": weakSubjectivitySyncLatest,
    "wss.syncUrl": weakSubjectivityServerUrl,
    "wss.checkpoint": weakSubjectivityCheckpoint,
  } = args;
  if (weakSubjectivityStateFile) {
    return {weakSubjectivityStateFile, weakSubjectivityCheckpoint} as WSSOptions;
  } else if (weakSubjectivitySyncLatest) {
    if (!weakSubjectivityServerUrl) {
      throw Error("Must set arg --wss.syncUrl for wss sync");
    }
    return {weakSubjectivitySyncLatest, weakSubjectivityServerUrl, weakSubjectivityCheckpoint} as WSSOptions;
  } else {
    return null;
  }
}

export const wssOptions: ICliCommandOptions<IWSSArgs> = {
  "wss.state": {
    description: "Path or URL to download a weak subjectivity state file in ssz-encoded format",
    type: "string",
    group: "weak subjectivity",
  },

  "wss.syncLatest": {
    description:
      "Sync and start from a weak subjectivity state at the latest finalized checkpoint via the --wss.syncUrl",
    type: "boolean",
    group: "weak subjectivity",
  },

  "wss.syncUrl": {
    description:
      "Pass in a server url hosting Beacon Node APIs from which to fetch weak subjectivity state, required in conjunction with --wss.syncLatest or --wss.checkpoint.",
    type: "string",
    group: "weak subjectivity",
  },

  "wss.checkpoint": {
    description:
      "Start beacon node off a state at the provided weak subjectivity checkpoint, to be supplied in <blockRoot>:<epoch> format. For example, 0x1234:100 will sync and start off from the weakSubjectivity state at checkpoint of epoch 100 with block root 0x1234.",
    type: "string",
    group: "weak subjectivity",
  },
};
