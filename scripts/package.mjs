import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const files = [
  'manifest.json', 'background.js', 'content.js',
  'popup.html', 'popup.css', 'popup.js',
  'options.html', 'options.css', 'options.js',
  'lib', 'icons', 'PRIVACY.md',
];
const root = process.cwd();
const version = JSON.parse(await fs.readFile('manifest.json', 'utf8')).version;
const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'rainmatter-air-'));
const outputDirectory = path.join(root, 'dist');
const output = path.join(outputDirectory, `rainmatter-air-${version}.zip`);

try {
  for (const file of files) await fs.cp(path.join(root, file), path.join(staging, file), { recursive: true });
  await fs.rm(outputDirectory, { recursive: true, force: true });
  await fs.mkdir(outputDirectory, { recursive: true });
  const result = spawnSync('zip', ['-q', '-r', output, '.'], { cwd: staging, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`zip exited with status ${result.status}`);
  console.log(`Created ${path.relative(root, output)}`);
} finally {
  await fs.rm(staging, { recursive: true, force: true });
}
