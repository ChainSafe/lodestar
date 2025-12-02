declare module "mitt" {
  export type Emitter<T extends Record<string, (...args: any[]) => void>> = {
    on<K extends keyof T>(type: K, handler: T[K]): void;
    off<K extends keyof T>(type: K, handler: T[K]): void;
    emit<K extends keyof T>(type: K, ...args: Parameters<T[K]>): void;
  };

  export function mitt<T>(): Emitter<T>;

  export default mitt;
}
