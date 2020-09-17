import {getSyncProtocols, INetwork} from "../../network";
import PeerId from "peer-id";

export type PeerFilterConditionCallback = (peer: PeerId) => boolean;

export function getSyncPeers(
  network: INetwork,
  condition: PeerFilterConditionCallback = () => true,
  maxPeers = 10,
  minScore = 60
): PeerId[] {
  return (
    network
      .getPeers({
        connected: true,
        supportsProtocols: getSyncProtocols(),
      })
      .map((peer) => peer.id)
      .filter((peer) => {
        return network.blockProviderScores.getScore(peer) > minScore && condition(peer);
      })
      .sort((p1, p2) => {
        return network.blockProviderScores.getScore(p2) - network.blockProviderScores.getScore(p1);
      })
      //take 10 best peers for sync
      .slice(0, maxPeers)
  );
}
