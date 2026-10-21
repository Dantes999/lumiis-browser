// Types for the sprite-sheet checker, so tests and tools can import it.

export type FrameInfo = {
  empty: boolean;
  count: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  hash: number;
};

export type SheetCheck = {
  file: string;
  errors: string[];
  warnings: string[];
  rows: number;
  width: number;
  height: number;
  /** Per row (view) and column; only set when the file could be decoded. */
  frames?: FrameInfo[][];
};

export type PackPart = { id: string; name: string; sheet: string };

export type PackLike = {
  name: string;
  cell: number;
  columns: number;
  footX?: number;
  footY?: number;
  armorRows?: string;
  bodyArt?: string;
  bodies?: PackPart[];
  heads?: PackPart[];
  hairs?: PackPart[];
  body?: string;
  head?: string;
  hair?: string;
  armor: string;
  weapon: string;
  rows?: string;
};

export type PackReport = {
  id: string;
  name: string;
  cell: number;
  columns: number;
  sheets: Array<{ key: string; url: string } & SheetCheck>;
  errors: string[];
  warnings: string[];
};

export type MonsterSheet = {
  key: string;
  url: string;
  width?: number;
  height?: number;
  errors?: string[];
  warnings: string[];
  frames?: FrameInfo[][];
};

export type MonsterReport = {
  cellW: number;
  cellH: number;
  views: number;
  frames: number;
  sheets: MonsterSheet[];
  errors: string[];
  warnings: string[];
};

export type DecodedPng = {
  width: number;
  height: number;
  /** RGBA, four bytes per pixel. */
  data: Uint8Array;
};

export declare const ROOT: string;
export declare function pngSize(file: string): { width: number; height: number };
export declare function decodePng(file: string): DecodedPng | null;
export declare function assetFile(url: string): string;
export declare function checkSheet(file: string, cell: number, columns: number): SheetCheck;
export declare function styleSheets(pack: PackLike): Array<{ key: string; path: string }>;
export declare function checkPack(id: string, pack: PackLike): PackReport;
export declare function checkAll(): PackReport[];
export declare function checkMonsters(): MonsterReport;
