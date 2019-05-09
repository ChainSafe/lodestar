declare module 'keccak256' {

  export default function hash(a: Buffer | (Buffer | string | number)[]): Buffer;

}
