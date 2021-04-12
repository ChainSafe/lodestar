import {getAttesterSlashings} from "./getAttesterSlashings";
import {getPoolAttestations} from "./getPoolAttestations";
import {getProposerSlashings} from "./getProposerSlashings";
import {getVoluntaryExits} from "./getVoluntaryExits";
import {submitAttesterSlashing} from "./submitAttesterSlashing";
import {submitPoolAttestation} from "./submitPoolAttestation";
import {submitProposerSlashing} from "./submitProposerSlashing";
import {submitVoluntaryExit} from "./submitVoluntaryExit";

export const beaconPoolRoutes = [
  getAttesterSlashings,
  getPoolAttestations,
  getProposerSlashings,
  getVoluntaryExits,
  submitAttesterSlashing,
  submitPoolAttestation,
  submitProposerSlashing,
  submitVoluntaryExit,
];
