// Pure JS/TS SHA-256 Implementation for browser environment compatibility
function sha256(ascii: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = 'length';
  let i;
  const hash = [] as number[];
  const words = [] as number[];

  const isPrime = {} as Record<number, boolean>;
  let candidate = 2;
  while (hash[lengthProperty] < 8) {
    if (!isPrime[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isPrime[i] = true;
      }
      hash.push((mathPow(candidate, 0.5) * maxWord) | 0);
    }
    candidate++;
  }

  const asciiLength = ascii[lengthProperty];
  const wordsLength = ((asciiLength + 8) >> 6) + 1;
  for (i = 0; i < wordsLength * 16; i++) {
    words[i] = 0;
  }
  for (i = 0; i < asciiLength; i++) {
    words[i >> 2] |= ascii.charCodeAt(i) << (24 - (i & 3) * 8);
  }
  words[asciiLength >> 2] |= 0x80 << (24 - (asciiLength & 3) * 8);
  words[wordsLength * 16 - 1] = asciiLength * 8;

  const k = [] as number[];
  candidate = 2;
  while (k[lengthProperty] < 64) {
    if (!isPrime[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isPrime[i] = true;
      }
      k.push((mathPow(candidate, 1 / 3) * maxWord) | 0);
    }
    candidate++;
  }

  for (let round = 0; round < wordsLength; round++) {
    const w = words.slice(round * 16, (round + 1) * 16);
    for (i = 16; i < 64; i++) {
      const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (i = 0; i < 64; i++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + k[i] + w[i]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }

  let result = '';
  for (i = 0; i < 8; i++) {
    const hex = (hash[i] >>> 0).toString(16);
    result += '00000000'.substring(hex.length) + hex;
  }
  return result;
}

// Shimming "crypto" Node.js module
class Hash {
  private data: string = '';
  update(data: string | Buffer): Hash {
    if (typeof data === 'string') {
      this.data += data;
    } else {
      this.data += data.toString('utf8');
    }
    return this;
  }
  digest(_encoding: string): string {
    return sha256(this.data);
  }
}

export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error('Unsupported hash algorithm: ' + algorithm);
  return new Hash();
}

export function randomBytes(size: number): Buffer {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) {
    buf[i] = Math.floor(Math.random() * 256);
  }
  return buf;
}

export function pbkdf2Sync(
  _password: any,
  _salt: any,
  _iterations: any,
  keylen: number,
  _digest: any,
): Buffer {
  return Buffer.alloc(keylen, 1);
}

class MockCipher {
  update(data: string | Buffer, _inputEnc?: any, _outputEnc?: any): any {
    return typeof data === 'string' ? data : data.toString('utf8');
  }
  final(_outputEnc?: any): any {
    return '';
  }
  getAuthTag(): Buffer {
    return Buffer.alloc(16, 2);
  }
  setAuthTag(_tag: Buffer): void {}
}

export function createCipheriv(_algorithm: string, _key: any, _iv: any): MockCipher {
  return new MockCipher();
}

export function createDecipheriv(_algorithm: string, _key: any, _iv: any): MockCipher {
  return new MockCipher();
}

// Shimming "path" Node.js module
export function resolve(...args: string[]): string {
  return args.filter(Boolean).join('/').replace(/\\/g, '/');
}

export function join(...args: string[]): string {
  return args.filter(Boolean).join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
}

export function relative(from: string, to: string): string {
  const normFrom = from.replace(/\\/g, '/');
  const normTo = to.replace(/\\/g, '/');
  if (normTo.startsWith(normFrom)) {
    let rel = normTo.slice(normFrom.length);
    if (rel.startsWith('/')) rel = rel.slice(1);
    return rel;
  }
  return to;
}

export function dirname(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  parts.pop();
  return parts.join('/') || '.';
}

export function basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() || '';
}

export function extname(p: string): string {
  const base = basename(p);
  const idx = base.lastIndexOf('.');
  return idx > 0 ? base.slice(idx) : '';
}

export function isAbsolute(p: string): boolean {
  if (!p) return false;
  const norm = p.replace(/\\/g, '/');
  return norm.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p);
}

export function normalize(p: string): string {
  if (!p) return '.';
  const isAbs = isAbsolute(p);
  const trailingSlash = p.endsWith('/') || p.endsWith('\\');
  const segments = p.replace(/\\/g, '/').split('/');
  const stack: string[] = [];

  for (const seg of segments) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop();
      } else if (!isAbs) {
        stack.push('..');
      }
    } else {
      stack.push(seg);
    }
  }

  let result = stack.join('/');
  if (isAbs) {
    result = '/' + result;
  }
  if (!result) {
    return isAbs ? '/' : '.';
  }
  if (trailingSlash && !result.endsWith('/')) {
    result += '/';
  }
  return result;
}

// Named exports from fs/promises to prevent esbuild undefined warnings
export async function readFile(_filePath: string): Promise<string> {
  return '';
}
export async function writeFile(_filePath: string, _content: string): Promise<void> {}
export async function readdir(_dirPath: string): Promise<string[]> {
  return [];
}
export async function readDir(_dirPath: string): Promise<string[]> {
  return [];
}
export async function mkdir(_dirPath: string): Promise<void> {}
export async function access(_filePath: string): Promise<void> {}
export async function rename(_oldPath: string, _newPath: string): Promise<void> {}
export async function unlink(_filePath: string): Promise<void> {}

// Named exports from fs (Sync methods)
export function readFileSync(_p: string, _encoding?: string): string {
  return '';
}
export function existsSync(_p: string): boolean {
  return false;
}
export function mkdirSync(_p: string, _options?: any) {}
export function writeFileSync(_p: string, _c: string, _options?: any) {}
export function readdirSync(_p: string): string[] {
  return [];
}
export function statSync(_p: string): any {
  return {
    mode: 0o600,
  };
}
export function chmodSync(_p: string, _mode: any): void {}

// Shimming promises block under fs
export const promises = {
  readFile,
  writeFile,
  readdir,
  readDir,
  mkdir,
  access,
  rename,
  unlink,
};

// Shimming "os" Node.js module
export function homedir(): string {
  return '';
}
export function hostname(): string {
  return 'web_host';
}
export function platform(): string {
  return 'web_platform';
}
export function arch(): string {
  return 'web_arch';
}
export function userInfo(): any {
  return {
    username: 'web_user',
  };
}

// Shimming "sqlite3" Node.js module
export class Database {
  constructor(path: string, callback?: (err: Error | null) => void) {
    if (callback) setTimeout(() => callback(null), 0);
  }
  exec(_sql: string, callback?: (err: Error | null) => void) {
    if (callback) setTimeout(() => callback(null), 0);
  }
  run(_sql: string, params?: any, callback?: any) {
    if (typeof params === 'function') params(null);
    else if (callback) callback(null);
  }
  get(_sql: string, params?: any, callback?: any) {
    if (typeof params === 'function') params(null, null);
    else if (callback) callback(null, null);
  }
  all(_sql: string, params?: any, callback?: any) {
    if (typeof params === 'function') params(null, []);
    else if (callback) callback(null, []);
  }
  prepare(_sql: string) {
    return {
      run: (params: any, cb: any) => {
        if (cb) cb(null);
      },
      get: (params: any, cb: any) => {
        if (cb) cb(null, null);
      },
      all: (params: any, cb: any) => {
        if (cb) cb(null, []);
      },
      finalize: (cb: any) => {
        if (cb) cb(null);
      },
    };
  }
  close(callback?: (err: Error | null) => void) {
    if (callback) setTimeout(() => callback(null), 0);
  }
}

// Default export shims
export default {
  createHash,
  resolve,
  join,
  relative,
  dirname,
  basename,
  extname,
  isAbsolute,
  normalize,
  promises,
  readFile,
  writeFile,
  readdir,
  readDir,
  mkdir,
  access,
  rename,
  unlink,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  homedir,
  Database,
};
