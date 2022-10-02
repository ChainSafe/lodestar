/* eslint-disable no-console */

interface ColumnOpts {
  width: number;
  widthFlexible?: boolean;
  header?: string;
}

type RowValueObj = {value: string | number; bad?: boolean};
type RowValues<K extends string> = Record<K, number | string | RowValueObj>;

export class TableRender<K extends string> {
  private hasPrintedHeader = false;
  private readonly keys: K[];

  constructor(private readonly columnSpecs: Record<K, ColumnOpts>) {
    this.keys = Object.keys(this.columnSpecs) as K[];
  }

  printRow(values: RowValues<K>): void {
    if (!this.hasPrintedHeader) {
      this.printHeader();
    }
    console.log(this.formatRow(values));
  }

  printHeader(): void {
    this.hasPrintedHeader = true;
    console.log(
      this.formatRow(
        Object.fromEntries(
          this.keys.map((key) => {
            const label = this.columnSpecs[key].header ?? key;
            return [key, label];
          })
        ) as RowValues<K>
      )
    );
  }

  private formatRow(values: RowValues<K>): string {
    const items = this.keys.map((key) => {
      const {width, widthFlexible} = this.columnSpecs[key];
      const value = this.formatValue(values[key]);
      return value.padEnd(width).slice(0, widthFlexible ? Infinity : width);
    });
    return items.join(" | ");
  }

  private formatValue(value: string | number | RowValueObj): string {
    if (typeof value === "object") {
      if (value.bad) {
        return "❌" + String(value.value);
      } else {
        return String(value.value);
      }
    } else {
      return String(value);
    }
  }
}
