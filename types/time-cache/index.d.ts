declare class TimeCache {
  put(data: string): void;
  has(data: string): boolean;
}

declare module "time-cache" {
  export default TimeCache;
}
