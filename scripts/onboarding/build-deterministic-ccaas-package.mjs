#!/usr/bin/env node
// Flow contract: emit byte-identical Fabric CCAAS packages on every supported host OS.
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const [connectionPath, metadataPath, outputPath] = process.argv.slice(2);
if (!connectionPath || !metadataPath || !outputPath) {
  throw new Error('Usage: build-deterministic-ccaas-package.mjs <connection.json> <metadata.json> <output.tgz>');
}

// Matches the already-governed public packages. The original canonical
// archive used 1980-01-01 00:00:00 America/Vancouver (08:00:00Z).
const MTIME = 315561600;
const BLOCK_SIZE = 512;

function writeText(block, offset, length, value) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > length) throw new Error(`USTAR field exceeds ${length} bytes.`);
  bytes.copy(block, offset);
}

function writeBsdNumeric(block, offset, length, value) {
  const octal = value.toString(8).padStart(length - 2, '0');
  writeText(block, offset, length, `${octal} \0`);
}

function writePosixNumeric(block, offset, length, value) {
  const octal = value.toString(8).padStart(length - 1, '0');
  writeText(block, offset, length, `${octal} `);
}

function tarHeader(name, size) {
  const block = Buffer.alloc(BLOCK_SIZE);
  writeText(block, 0, 100, name);
  writeBsdNumeric(block, 100, 8, 0o644);
  writeBsdNumeric(block, 108, 8, 0);
  writeBsdNumeric(block, 116, 8, 0);
  writePosixNumeric(block, 124, 12, size);
  writePosixNumeric(block, 136, 12, MTIME);
  block.fill(0x20, 148, 156);
  writeText(block, 156, 1, '0');
  writeText(block, 257, 6, 'ustar\0');
  writeText(block, 263, 2, '00');
  writeText(block, 265, 32, 'root');
  writeText(block, 297, 32, 'wheel');
  writeBsdNumeric(block, 329, 8, 0);
  writeBsdNumeric(block, 337, 8, 0);
  const checksum = block.reduce((sum, byte) => sum + byte, 0);
  writeText(block, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return block;
}

function tar(entries) {
  const parts = [];
  for (const [name, content] of entries) {
    parts.push(tarHeader(name, content.length), content);
    const padding = (BLOCK_SIZE - (content.length % BLOCK_SIZE)) % BLOCK_SIZE;
    if (padding) parts.push(Buffer.alloc(padding));
  }
  parts.push(Buffer.alloc(BLOCK_SIZE * 2));
  const archive = Buffer.concat(parts);
  // BSD tar writes complete 20-block records. Preserve that governed byte
  // contract explicitly instead of inheriting the host tar implementation.
  const recordSize = BLOCK_SIZE * 20;
  const padding = (recordSize - (archive.length % recordSize)) % recordSize;
  return padding ? Buffer.concat([archive, Buffer.alloc(padding)]) : archive;
}

function gzip(content) {
  const archive = gzipSync(content, { level: 6, mtime: 0 });
  // zlib writes the host OS into byte 9. Fabric hashes the complete package,
  // so normalize it to the canonical Unix value instead of leaking macOS,
  // Linux or another build host into the package ID.
  archive[9] = 3;
  return archive;
}

const connection = await readFile(connectionPath);
const metadata = await readFile(metadataPath);
const codeArchive = gzip(tar([['connection.json', connection]]));
const packageArchive = gzip(tar([
  ['metadata.json', metadata],
  ['code.tar.gz', codeArchive],
]));
await writeFile(outputPath, packageArchive, { mode: 0o600 });
