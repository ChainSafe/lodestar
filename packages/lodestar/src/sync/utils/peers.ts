import {getSyncProtocols, INetwork} from "../../network";
import PeerId from "peer-id";
import {ScoreState} from "../../network/peers";

export type PeerFilterConditionCallback = (peer: PeerId) => boolean;

export function getSyncPeers(
  network: INetwork,
  condition: PeerFilterConditionCallback = () => true,
  maxPeers = 10
): PeerId[] {
  return (
    network
      .getPeers({
        supportsProtocols: getSyncProtocols(),
      })
      .map((peer) => peer.id)
      .filter((peer) => {
        return network.peerRpcScores.getScoreState(peer) === ScoreState.Healthy && condition(peer);
      })
      .sort((p1, p2) => {
        return network.peerRpcScores.getScore(p2) - network.peerRpcScores.getScore(p1);
      })
      // take 10 best peers for sync
      .slice(0, maxPeers)
  );
}
