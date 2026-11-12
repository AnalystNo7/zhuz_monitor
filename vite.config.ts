import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Сборка в один автономный HTML-файл: скрипты и стили встраиваются внутрь.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { target: 'es2022', cssCodeSplit: false, assetsInlineLimit: 100_000_000 },
  test: { include: ['tests/**/*.test.ts'] },
});
