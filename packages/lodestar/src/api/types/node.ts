/* eslint-disable @typescript-eslint/interface-name-prefix */

import {Metadata} from "@chainsafe/lodestar-types";

export interface NodeIdentity {
  peerId: string;
  enr: string;
  p2pAddresses: string[];
  discoveryAddresses: string[];
  metadata: Metadata;
}

export interface NodePeer {
  peerId: string;
  enr: string;
  address: string;
  state: "disconnected"|"connecting"|"connected"|"disconnecting";
  direction: "inbound"|"outbound";
}
