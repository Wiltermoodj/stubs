// Pure JS/TS SHA-256 Implementation for browser environment compatibility
function sha256(ascii: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = 'length';
  let i, j;
  const hash = [] as number[];
  const words = [] as number[];

  const isPrime = {} as Record<number, boolean>;
  let candidate = 2;
  while (hash[lengthProperty] < 8) {
    if (!isPrime[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isPrime[i] = true;
      }
      hash.push((mathPow(candidate, .5) * maxWord) | 0);
    }
    candidate++;
  }

  let asciiLength = ascii[lengthProperty];
  let wordsLength = ((asciiLength + 8) >> 6) + 1;
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
      k.push((mathPow(candidate, 1/3) * maxWord) | 0);
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
  digest(encoding: string): string {
    return sha256(this.data);
  }
}

export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error('Unsupported hash algorithm: ' + algorithm);
  return new Hash();
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

// Named exports from fs/promises to prevent esbuild undefined warnings
export async function readFile(filePath: string): Promise<string> { return ''; }
export async function writeFile(filePath: string, content: string): Promise<void> {}
export async function readdir(dirPath: string): Promise<string[]> { return []; }
export async function readDir(dirPath: string): Promise<string[]> { return []; }
export async function mkdir(dirPath: string): Promise<void> {}
export async function access(filePath: string): Promise<void> {}
export async function rename(oldPath: string, newPath: string): Promise<void> {}
export async function unlink(filePath: string): Promise<void> {}

// Named exports from fs (Sync methods)
export function readFileSync(p: string, encoding?: string): string { return ''; }
export function existsSync(p: string): boolean { return false; }
export function mkdirSync(p: string, options?: any) {}
export function writeFileSync(p: string, c: string, options?: any) {}
export function readdirSync(p: string): string[] { return []; }

// Shimming promises block under fs
export const promises = {
  readFile,
  writeFile,
  readdir,
  readDir,
  mkdir,
  access,
  rename,
  unlink
};

// Shimming "os" Node.js module
export function homedir(): string {
  return '';
}

// Shimming "sqlite3" Node.js module
export class Database {
  constructor(path: string, callback?: (err: Error | null) => void) {
    if (callback) setTimeout(() => callback(null), 0);
  }
  exec(sql: string, callback?: (err: Error | null) => void) {
    if (callback) setTimeout(() => callback(null), 0);
  }
  run(sql: string, params?: any, callback?: any) {
    if (typeof params === 'function') params(null);
    else if (callback) callback(null);
  }
  get(sql: string, params?: any, callback?: any) {
    if (typeof params === 'function') params(null, null);
    else if (callback) callback(null, null);
  }
  all(sql: string, params?: any, callback?: any) {
    if (typeof params === 'function') params(null, []);
    else if (callback) callback(null, []);
  }
  prepare(sql: string) {
    return {
      run: (params: any, cb: any) => { if (cb) cb(null); },
      get: (params: any, cb: any) => { if (cb) cb(null, null); },
      all: (params: any, cb: any) => { if (cb) cb(null, []); },
      finalize: (cb: any) => { if (cb) cb(null); }
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
  Database
};
