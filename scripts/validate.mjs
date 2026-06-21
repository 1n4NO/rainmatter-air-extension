import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const required = [
  'manifest.json',
  'package.json',
  'background.js',
  'content.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'options.html',
  'options.css',
  'options.js',
  'lib/air-quality.js',
  'test/air-quality.test.mjs',
];

const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
const missing = [];

for (const file of required) {
  try {
    await fs.access(path.join(root, file));
  } catch {
    missing.push(file);
  }
}

if (manifest.manifest_version !== 3) {
  throw new Error('manifest_version must be 3');
}

if (!Array.isArray(manifest.content_scripts) || manifest.content_scripts.length === 0) {
  throw new Error('content_scripts are required');
}

if (!manifest.action?.default_popup) {
  throw new Error('popup must be configured');
}

if (missing.length) {
  throw new Error(`missing files: ${missing.join(', ')}`);
}

console.log('Validation passed for Rainmatter Air extension scaffold.');
