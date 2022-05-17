import {ICliCommandOptions} from "../util";

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
