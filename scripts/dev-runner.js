import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const args = process.argv.slice(2);
const command = args[0] || 'dev';
const restArgs = args.slice(1);

const userHome = process.env.USERPROFILE || 'C:\\Users\\APPUz';
const cargoBin = path.join(userHome, '.cargo', 'bin');
const nodeBin = 'C:\\Program Files\\nodejs';

const gstreamerPath = process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64 || 'C:\\Users\\APPUz\\AppData\\Local\\Programs\\gstreamer\\1.0\\msvc_x86_64';
const gstreamerBin = path.join(gstreamerPath, 'bin');

const origPath = process.env.PATH || process.env.Path || process.env.path || '';

const pathParts = [];
if (fs.existsSync(cargoBin)) pathParts.push(cargoBin);
if (fs.existsSync(gstreamerBin)) pathParts.push(gstreamerBin);
if (fs.existsSync(nodeBin)) pathParts.push(nodeBin);
if (origPath) pathParts.push(origPath);

const newPath = pathParts.join(';');

const env = { 
  ...process.env,
  PATH: newPath,
  Path: newPath,
  ORC_CODE: 'backup',
  OPENSSL_ia32cap: '~0x20000000'
};

const tauriCli = path.resolve('node_modules', '@tauri-apps', 'cli', 'tauri.js');

const child = spawn(process.execPath, [tauriCli, command, ...restArgs], {
  stdio: 'inherit',
  env
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
