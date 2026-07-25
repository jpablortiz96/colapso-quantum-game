import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

const optionalPublicUrlBlock = /\s*<!-- colapso-public-url:start -->[\s\S]*?<!-- colapso-public-url:end -->/u;

function normalizePublicSiteUrl(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return null;
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error("VITE_PUBLIC_SITE_URL must be a public HTTPS origin or deployment path without credentials, query, or hash.");
  }
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("VITE_PUBLIC_SITE_URL cannot point to localhost.");
  }
  return url.toString().replace(/\/$/u, "");
}

function productionMetadata(publicSiteUrl: string | null): Plugin {
  return {
    name: "colapso-production-metadata",
    transformIndexHtml(html) {
      if (publicSiteUrl === null) return html.replace(optionalPublicUrlBlock, "");
      return html.replace(optionalPublicUrlBlock, (block) => block
        .replace("<!-- colapso-public-url:start -->", "")
        .replace("<!-- colapso-public-url:end -->", "")
        .replaceAll("%COLAPSO_PUBLIC_URL%", publicSiteUrl));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const publicSiteUrl = normalizePublicSiteUrl(env.VITE_PUBLIC_SITE_URL);

  return {
    plugins: [productionMetadata(publicSiteUrl), react(), tailwindcss()],
    build: {
      sourcemap: false,
      chunkSizeWarningLimit: 650,
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      restoreMocks: true,
      clearMocks: true,
      coverage: {
        provider: "v8",
        include: ["src/engine/**/*.ts"],
        exclude: [
          "src/engine/**/*.test.ts",
          "src/engine/**/*.property.test.ts",
          "src/engine/types.ts",
          "src/engine/errors.ts",
        ],
        reporter: ["text", "json-summary"],
        thresholds: {
          lines: 95,
          branches: 90,
        },
      },
    },
  };
});
