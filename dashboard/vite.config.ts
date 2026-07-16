import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5174,
    // Si el 5173 está ocupado, avisa y no salta a otro puerto en silencio
    // (así el navegador siempre apunta al mismo sitio).
    strictPort: true,
  },
});
