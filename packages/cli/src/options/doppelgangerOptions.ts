import {ICliCommandOptions} from "../util/index.js";

type DoppelgangerOps = {
  enableDoppelganger?: boolean;
};

export const doppelgangerOptions: ICliCommandOptions<DoppelgangerOps> = {
  enableDoppelganger: {
    description: "Enables Doppelganger protection",
    default: false,
    type: "boolean",
  },
};
