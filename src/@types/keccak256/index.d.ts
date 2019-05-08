declare module 'keccak256' {

    export default function hash(a: Buffer | Array<Buffer | string | number>): Buffer;

}
