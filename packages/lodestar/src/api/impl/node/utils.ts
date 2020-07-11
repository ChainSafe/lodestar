import {NodePeer} from "../../types";

export function getPeerState(status: LibP2pConnection["stat"]["status"]): NodePeer["state"] {
  switch (status) {
    case "closed": return "disconnected";
    case "closing": return "disconnecting";
    case "open": return "connected";
    default:
      return "disconnected";
  }
}
