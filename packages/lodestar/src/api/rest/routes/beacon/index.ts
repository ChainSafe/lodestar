import {FastifyInstance} from "fastify";
import {registerRoutesToServer} from "../util";
import {
  getBlock,
  getBlockAttestations,
  getBlockHeader,
  getBlockHeaders,
  getBlockRoot,
  getGenesis,
  getPoolAttestations,
  getStateBeaconCommittees,
  getStateFinalityCheckpoints,
  getStateFork,
  getStateValidator,
  getStateValidators,
  getVoluntaryExits,
  publishBlock,
  submitVoluntaryExit,
  getStateValidatorsBalances,
  getAttesterSlashings,
  getProposerSlashings,
  submitAttesterSlashing,
  submitPoolAttestation,
  submitProposerSlashing,
} from "../../controllers/beacon";

//new
export function registerBeaconRoutes(server: FastifyInstance): void {
  const routes = [
    getGenesis,
    getStateFinalityCheckpoints,
    getStateFork,
    getStateBeaconCommittees,
    getStateValidator,
    getStateValidators,
    getStateValidatorsBalances,
    getPoolAttestations,
    getAttesterSlashings,
    getProposerSlashings,
    getVoluntaryExits,
    getBlockHeaders,
    getBlockHeader,
    getBlock,
    getBlockRoot,
    getBlockAttestations,
    submitPoolAttestation,
    submitAttesterSlashing,
    submitProposerSlashing,
    submitVoluntaryExit,
    publishBlock,
  ];

  registerRoutesToServer(server, routes, "/v1/beacon");
}
