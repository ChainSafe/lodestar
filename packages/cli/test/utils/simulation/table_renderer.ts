import {strFixedSize} from "./utils/index.js";

export class TableRenderer<Columns extends string[number]> {
  private columnsSizes: Record<Columns, number>;
  private columns: Columns[];
  private rows: Record<Columns, unknown>[];
  private totalWidth: number;

  constructor(columnWithSizes: Record<Columns, number>) {
    this.columnsSizes = columnWithSizes;
    this.columns = Object.keys(columnWithSizes) as Columns[];
    this.rows = [];
    const sizes = Object.values(this.columnsSizes) as number[];
    this.totalWidth = sizes.reduce((a, b) => a + b, 0) + this.columns.length + 1 + this.columns.length * 2;
  }

  addRow(data: Record<Columns, unknown>): void {
    this.rows.push(data);
    this.printRow(this.rows.length - 1);
  }

  addEmptyRow(text: string): void {
    this.printHSeparator(true);
    this.printVSeparator("start");
    process.stdout.write(strFixedSize(text, this.totalWidth - 4));
    this.printVSeparator("end");
    this.printHSeparator(true);
  }

  printHeader(): void {
    this.printHSeparator(true);
    this.printVSeparator("start");
    for (const [index, column] of this.columns.entries()) {
      process.stdout.write(strFixedSize(column, this.columnsSizes[column]));
      if (index === this.columns.length - 1) {
        this.printVSeparator("end");
      } else {
        this.printVSeparator();
      }
    }
    this.printHSeparator(true);
  }

  printRow(rowIndex: number): void {
    const row = this.rows[rowIndex];

    this.printVSeparator("start");
    for (const [index, column] of this.columns.entries()) {
      const value = String(row[column]);
      process.stdout.write(value.padEnd(this.columnsSizes[column]));
      if (index === this.columns.length - 1) {
        this.printVSeparator("end");
      } else {
        this.printVSeparator();
      }
    }
  }

  private printHSeparator(lineBreak: boolean): void {
    process.stdout.write(`┼${"─".repeat(this.totalWidth - 2)}┼`);
    if (lineBreak) process.stdout.write("\n");
  }

  private printVSeparator(mode?: "start" | "end"): void {
    if (!mode) {
      process.stdout.write(" │ ");
    } else if (mode === "start") {
      process.stdout.write("│ ");
    } else if (mode === "end") {
      process.stdout.write(" │\n");
    }
  }
}
