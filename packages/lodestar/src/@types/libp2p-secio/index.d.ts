// Type definitions for libp2p-secio 0.10.0
// Project: https://github.com/libp2p/js-libp2p-secio
// Definitions by: Jaco Greeff <https://github.com/jacogr>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

/// <reference types="peer-id"/>

declare type LibP2pSecio = {
  encrypt (localId: PeerId, conn: any, remoteId: PeerId, callback: () => any): void
}

declare module 'libp2p-secio' {
const secio: LibP2pSecio;

export default secio;
}
