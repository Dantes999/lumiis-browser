// Types for the sprite-sheet checker, so tests can import the tool.

export type SheetCheck = {
  file: string;
  errors: string[];
  rows: number;
  width: number;
  height: number;
};

export type PackReport = {
  id: string;
  name: string;
  cell: number;
  columns: number;
  sheets: Array<{ key: string; url: string } & SheetCheck>;
  errors: string[];
};

export declare const ROOT: string;
export declare function pngSize(file: string): { width: number; height: number };
export declare function assetFile(url: string): string;
export declare function checkSheet(file: string, cell: number, columns: number): SheetCheck;
export declare function styleSheets(pack: {
  body: string;
  head: string;
  hair: string;
  armor: string;
  weapon: string;
}): Array<{ key: string; path: string }>;
export declare function checkPack(
  id: string,
  pack: { name: string; cell: number; columns: number; body: string; head: string; hair: string; armor: string; weapon: string },
): PackReport;
export declare function checkAll(): PackReport[];
