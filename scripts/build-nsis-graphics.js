import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logoPath = path.join(__dirname, '..', 'src-tauri', 'icons', 'Square310x310Logo.png');
const sidebarDst = path.join(__dirname, '..', 'src-tauri', 'icons', 'nsis-sidebar.png');
const headerDst = path.join(__dirname, '..', 'src-tauri', 'icons', 'nsis-header.png');

console.log('Copying logo assets for NSIS installer...');
fs.copyFileSync(logoPath, sidebarDst);
fs.copyFileSync(logoPath, headerDst);
console.log('NSIS graphics created successfully!');
