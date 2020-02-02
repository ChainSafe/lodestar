// Type definitions for peer-book 0.8.0
// Project: https://github.com/libp2p/js-peer-book
// Definitions by: Jaco Greeff <https://github.com/jacogr>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

/// <reference types="peer-id"/>
/// <reference types="peer-info"/>

declare class PeerBook {
    constructor ();

    get (peer: PeerId | PeerInfo | string): PeerInfo;
    getAll (): { [peerId: string]: PeerInfo };
    getAllArray (): PeerInfo[];
    getMultiaddrs (peer: PeerId | PeerInfo | string): string[];
    has (peer: PeerId | PeerInfo | string): boolean;
    put (peerInfo: PeerInfo, replace?: boolean): PeerInfo;
    remove (peerInfo: PeerInfo, replace?: boolean): void;
}

declare module 'peer-book' {
export default PeerBook;
}
