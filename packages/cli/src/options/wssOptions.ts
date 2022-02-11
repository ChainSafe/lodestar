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
  "wss.weakSubjectivityStateFile": string;
  "wss.weakSubjectivitySyncLatest": boolean;
  "wss.weakSubjectivityCheckpoint": string;
  "wss.weakSubjectivityServerUrl": string;
}

export function parseWSSArgs(args: IWSSArgs): WSSOptions | null {
  const {
    "wss.weakSubjectivityStateFile": weakSubjectivityStateFile,
    "wss.weakSubjectivitySyncLatest": weakSubjectivitySyncLatest,
    "wss.weakSubjectivityCheckpoint": weakSubjectivityCheckpoint,
    "wss.weakSubjectivityServerUrl": weakSubjectivityServerUrl,
  } = args;
  if (weakSubjectivityStateFile) {
    return {weakSubjectivityStateFile, weakSubjectivityCheckpoint} as WSSOptions;
  } else if (weakSubjectivitySyncLatest) {
    if (!weakSubjectivityServerUrl) {
      throw Error("Must set arg --weakSubjectivityServerUrl for wss sync");
    }
    return {weakSubjectivitySyncLatest, weakSubjectivityServerUrl, weakSubjectivityCheckpoint} as WSSOptions;
  } else {
    return null;
  }
}

export const wssOptions: ICliCommandOptions<IWSSArgs> = {
  "wss.weakSubjectivityStateFile": {
    description: "Path or URL to download a weak subjectivity state file in ssz-encoded format",
    type: "string",
    group: "wss",
  },

  "wss.weakSubjectivitySyncLatest": {
    description:
      "Enable fetching of a weak subjectivity state via --weakSubjectivityServerUrl.  If an argument is provided to --weakSubjectivityCheckpoint, fetch the state at that checkpoint.  Else, fetch the latest finalized state.",
    type: "boolean",
    group: "wss",
  },

  "wss.weakSubjectivityCheckpoint": {
    description:
      "Tell the beacon node to fetch a weak subjectivity state at the specified checkpoint. The string arg must be in the form <blockRoot>:<epoch>. For example, 0x1234:100 would ask for the weak subjectivity state at checkpoint of epoch 100 with block root 0x1234.",
    type: "string",
    group: "wss",
  },

  "wss.weakSubjectivityServerUrl": {
    description:
      "Pass in a server hosting Beacon Node APIs from which to fetch weak subjectivity state, required in conjunction with --weakSubjectivitySyncLatest or --weakSubjectivityCheckpoint sync.",
    type: "string",
    group: "wss",
  },
};
