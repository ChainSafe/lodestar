import {ICliCommandOptions} from "../util";

type DoppelgangerOps = {
  enableDoppelganger?: boolean;
  doppelgangerEpochsToCheck?: number;
};

export const doppelgangerOptions: ICliCommandOptions<DoppelgangerOps> = {
  enableDoppelganger: {
    description: "Enables Doppelganger protection",
    defaultDescription: "false",
    default: false,
    type: "boolean",
  },

  doppelgangerEpochsToCheck: {
    description: "Number of epoch to check before assuming no other duplicate validators on the network",
    default: 1,
    type: "number",
  },
};
