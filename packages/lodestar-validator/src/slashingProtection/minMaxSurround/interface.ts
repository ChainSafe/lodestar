export type Att = {target: number; source: number};

export interface IMinMaxSurround {
  check(att: Att): Promise<void>;
  checkAndInsert(att: Att): Promise<void>;
}

export interface IDistanceEntry {
  source: number;
  distance: number;
}

export type IDistanceStore = {
  [P in "minSpan" | "maxSpan"]: {
    get(epoch: number): Promise<number | null>;
    setBatch(values: IDistanceEntry[]): Promise<void>;
  };
};
