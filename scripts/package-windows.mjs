// Arma build/staging para el instalador de Windows x64:
//   staging/node/node.exe   Node empaquetado
//   staging/app/            servidor (dist + node_modules de producción, incluido better-sqlite3 nativo)
//   staging/pos/dist/       interfaz compilada
// Debe correr en Windows x64 (para que better-sqlite3 se instale con su binario de win32-x64).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

if (process.platform !== 'win32') {
  console.error('package-windows.mjs debe ejecutarse en Windows x64.');
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, '..');
const staging = path.join(root, 'staging');
const nodeVersion = process.env.NODE_VERSION ?? '22.12.0';
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root, shell: true, ...opts });

fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

// 1. Servidor con dependencias de producción
run('pnpm', ['--filter', '@pos/server', 'deploy', '--prod', '--legacy', path.join(staging, 'app')]);

// 2. Interfaz compilada
fs.cpSync(path.join(root, 'apps', 'pos', 'dist'), path.join(staging, 'pos', 'dist'), {
  recursive: true,
});

// 3. Node empaquetado (solo node.exe)
const zipName = `node-v${nodeVersion}-win-x64`;
const zipPath = path.join(staging, `${zipName}.zip`);
run('curl', ['-fsSL', '-o', zipPath, `https://nodejs.org/dist/v${nodeVersion}/${zipName}.zip`]);
run('powershell', [
  '-NoProfile',
  '-Command',
  `Expand-Archive -Path '${zipPath}' -DestinationPath '${staging}'`,
]);
fs.mkdirSync(path.join(staging, 'node'), { recursive: true });
fs.copyFileSync(path.join(staging, zipName, 'node.exe'), path.join(staging, 'node', 'node.exe'));
fs.rmSync(path.join(staging, zipName), { recursive: true, force: true });
fs.rmSync(zipPath);

console.log(`Paquete listo en ${staging}`);
