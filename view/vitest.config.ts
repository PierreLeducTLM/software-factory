import { playwright } from '@vitest/browser-playwright';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [viteReact()],
  test: {
    include: ['src/**/*.test.tsx'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
    coverage: { provider: 'v8', include: ['src/components/**', 'src/format.ts'], exclude: ['src/components/fixtures.ts', 'src/**/*.test.tsx'] },
  },
});
