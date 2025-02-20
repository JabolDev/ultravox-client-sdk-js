import { mkdir, copyFile } from 'fs/promises';
import { dirname } from 'path';

async function copyFiles() {
  try {
    // Ensure dist/esm directory exists
    await mkdir('dist/esm', { recursive: true });

    // Copy worklet file
    await copyFile('src/noise-suppressor.worklet.js', 'dist/esm/noise-suppressor.worklet.js');

    console.log('Files copied successfully');
  } catch (err) {
    console.error('Error copying files:', err);
    process.exit(1);
  }
}

copyFiles();
