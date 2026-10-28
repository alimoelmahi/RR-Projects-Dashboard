import { defineConfig } from "vite";

export default defineConfig({
  server: {
    watch: {
      ignored: ["**/ACLED Data_*.csv"],
    },
  },
});
