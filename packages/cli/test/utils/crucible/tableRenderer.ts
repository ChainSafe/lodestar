import {Logger} from "@lodestar/logger";
import {strFixedSize} from "./utils/index.js";

const V_SEP_M = " │ ";
const V_SEP_S = "│ ";
const V_SEP_E = " │";

export class TableRenderer<Columns extends string[number]> {
  readonly logger: Logger;
  private columnsSizes: Record<Columns, number>;
  private columns: Columns[];
  private rows: Record<Columns, unknown>[];
  private totalWidth: number;

  constructor(columnWithSizes: Record<Columns, number>, {logger}: {logger: Logger}) {
    this.logger = logger;
    this.columnsSizes = columnWithSizes;
    this.columns = Object.keys(columnWithSizes) as Columns[];
    this.rows = [];
    const sizes: number[] = Object.values(this.columnsSizes);
    this.totalWidth = sizes.reduce((a, b) => a + b, 0) + this.columns.length + 1 + this.columns.length * 2;
  }

  addRow(data: Record<Columns, unknown>): void {
    this.rows.push(data);
    this.printRow(this.rows.length - 1);
  }

  addEmptyRow(text: string): void {
    this.printHSeparator();
    this.logger.info(`${V_SEP_S}${strFixedSize(text, this.totalWidth - 4)}${V_SEP_E}`);
    this.printHSeparator();
  }

  printHeader(): void {
    this.printHSeparator();
    const output = [V_SEP_S];
    for (const [index, column] of this.columns.entries()) {
      output.push(strFixedSize(column, this.columnsSizes[column]));
      if (index === this.columns.length - 1) {
        output.push(V_SEP_E);
      } else {
        output.push(V_SEP_M);
      }
    }
    this.logger.info(output.join(""));
    this.printHSeparator();
  }

  printRow(rowIndex: number): void {
    const row = this.rows[rowIndex];
    const output = [V_SEP_S];
    for (const [index, column] of this.columns.entries()) {
      const value = String(row[column]);
      output.push(value.padEnd(this.columnsSizes[column]));
      if (index === this.columns.length - 1) {
        output.push(V_SEP_E);
      } else {
        output.push(V_SEP_M);
      }
    }
    this.logger.info(output.join(""));
  }

  private printHSeparator(): void {
    this.logger.info(`┼${"─".repeat(this.totalWidth - 2)}┼`);
  }
}
