// Type definitions for peer-info 0.14.1
// Project: https://github.com/libp2p/js-peer-info
// Definitions by: Jaco Greeff <https://github.com/jacogr>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

/// <reference types="node"/>
/// <reference types="multiaddr"/>
/// <reference types="peer-id"/>

declare namespace PeerInfo {
    type CreateCb = (error: Error | null, peerId?: PeerInfo) => any;

    type CreateOptions = {
        bits: number
    };

    type MultiaddrSet = {
        readonly size: number;

        add(addr: Multiaddr.Multiaddr | string): void;
        addSafe(add: Multiaddr.Multiaddr | string): void;
        delete(addr: Multiaddr.Multiaddr): void;
        forEach(cb: (addr: Multiaddr.Multiaddr, index: number) => any): void;
        has(addr: Multiaddr.Multiaddr): boolean;
        replace(addr: Multiaddr.Multiaddr, other: Multiaddr.Multiaddr): void;
        toArray(): Multiaddr.Multiaddr[];
    };
}

declare class PeerInfo {
    constructor(id?: PeerId);

    static create(optsOrCb: PeerInfo.CreateOptions | PeerInfo.CreateCb, cb?: PeerInfo.CreateCb): void;
    static isPeerInfo(info: any): info is PeerInfo;

    readonly id: PeerId;
    readonly multiaddrs: PeerInfo.MultiaddrSet;

    connect(addr: Multiaddr.Multiaddr): void;
    disconnect(): void;
    isConnected(): boolean;
}

declare module 'peer-info' {
    export default PeerInfo;
}
