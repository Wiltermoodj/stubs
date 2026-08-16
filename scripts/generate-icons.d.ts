// Type declarations for the CommonJS build script scripts/generate-icons.js, which is not
// covered by tsconfig's `include` but is imported by tests/webBuild.test.ts to prove the
// emitted PWA icons are reproducible from their source parameters.

export interface IconSpec {
  /** Filename emitted into dist/web/. */
  file: string;
  /** Square edge length in pixels. */
  size: number;
  /** Fraction of the canvas the mark occupies. */
  glyphScale: number;
  /** Web App Manifest icon purpose. */
  purpose: 'any' | 'maskable';
}

export declare const ICONS: IconSpec[];
export declare const BACKGROUND: string;
export declare const GLYPH: string;
export declare const GLYPH_DIM: string;

export declare function renderIcon(size: number, glyphScale: number): Buffer;
export declare function encodePng(size: number, rgba: Buffer): Buffer;
export declare function crc32(buf: Buffer): number;
