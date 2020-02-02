// Type definitions for interface-connection 0.3.2
// Project: https://github.com/libp2p/interface-connection
// Definitions by: Jaco Greeff <https://github.com/jacogr>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

/// <reference types="peer-info"/>

declare interface LibP2pConnection {
  getPeerInfo (cb: (error: Error | null, peerInfo?: PeerInfo) => any): void;
}