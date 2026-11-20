import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// obsidian パッケージは型定義だけで実体が無いので、test では空の stub に向ける (中身は vi.mock で差す)
export default defineConfig({
  test: {
    alias: { obsidian: fileURLToPath(new URL("./tests/obsidian-stub.ts", import.meta.url)) },
  },
});
