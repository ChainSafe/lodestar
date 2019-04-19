import {PeerBook} from "peer-book";

export default {
  maxPeers: 25,
  refreshInterval: 15000,
  peerBook: new PeerBook(),
  bootnodes: []
};
