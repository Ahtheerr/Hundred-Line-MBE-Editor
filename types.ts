
export enum ColumnType {
  INT = 2,
  STR = 7,
  STRID = 8, // Treated same as STR for data editing
}

export interface MbeColumn {
  type: ColumnType;
  typeName: 'int' | 'str' | 'strID';
}

export interface MbeRow {
  id: string; // For React key
  cells: (number | string)[];
}

export interface MbeSheet {
  name: string;
  columns: MbeColumn[];
  rows: MbeRow[];
  parsedExpaAreaSizePerRow: number; // Store this from parsing for generation if needed for validation
}

export interface MbeFile {
  sheets: MbeSheet[];
}

// Helper type for string encoding/decoding
export type StringEncoding = 'utf-8' | 'latin1'; // Add more if needed
    