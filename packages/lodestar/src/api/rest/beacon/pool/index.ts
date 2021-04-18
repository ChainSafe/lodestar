import {getPoolAttestations} from "./getPoolAttestations";
import {getPoolAttesterSlashings} from "./getPoolAttesterSlashings";
import {getPoolProposerSlashings} from "./getPoolProposerSlashings";
import {getPoolVoluntaryExits} from "./getPoolVoluntaryExits";
import {submitPoolAttestations} from "./submitPoolAttestations";
import {submitPoolAttesterSlashings} from "./submitPoolAttesterSlashings";
import {submitPoolProposerSlashings} from "./submitPoolProposerSlashings";
import {submitPoolVoluntaryExit} from "./submitPoolVoluntaryExit";

export const beaconPoolRoutes = [
  getPoolAttestations,
  getPoolAttesterSlashings,
  getPoolProposerSlashings,
  getPoolVoluntaryExits,
  submitPoolAttestations,
  submitPoolAttesterSlashings,
  submitPoolProposerSlashings,
  submitPoolVoluntaryExit,
];
