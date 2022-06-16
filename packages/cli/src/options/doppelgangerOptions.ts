import {ICliCommandOptions} from "../util/index.js";

type DoppelgangerOps = {
  doppelgangerProtectionEnabled?: boolean;
};

export const doppelgangerOptions: ICliCommandOptions<DoppelgangerOps> = {
  doppelgangerProtectionEnabled: {
    description: "Enables Doppelganger protection",
    default: false,
    type: "boolean",
  },
};
