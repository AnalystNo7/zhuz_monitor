// Переименовывает результат сборки в файл, который удобно пересылать.
import { renameSync, statSync } from 'node:fs';

const out = 'dist/zhuz-monitor.html';
renameSync('dist/index.html', out);
console.log(`${out}: ${(statSync(out).size / 1024).toFixed(0)} КБ`);
