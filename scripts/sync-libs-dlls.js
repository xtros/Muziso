import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const gstBin = path.join(__dirname, '..', 'src-tauri', 'gstreamer', 'bin');
const libsDir = path.join(__dirname, '..', 'src-tauri', 'libs');

if (!fs.existsSync(libsDir)) {
  fs.mkdirSync(libsDir, { recursive: true });
}

if (fs.existsSync(gstBin)) {
  console.log('Syncing GStreamer bin DLLs to src-tauri/libs for WiX (.msi) installer...');
  const files = fs.readdirSync(gstBin);
  let count = 0;
  for (const file of files) {
    if (file.endsWith('.dll')) {
      const src = path.join(gstBin, file);
      const dst = path.join(libsDir, file);
      fs.copyFileSync(src, dst);
      count++;
    }
  }
  console.log(`Successfully synced ${count} DLLs to src-tauri/libs!`);
} else {
  console.warn('gstreamer/bin directory not found locally; skipping DLL sync.');
}
