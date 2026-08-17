import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import crypto from "node:crypto";

const catalogPath = path.resolve(process.cwd(), "config/business_catalog.yaml");

function catalogApi() {
  return {
    name: "business-catalog-api",
    configureServer(server) {
      server.middlewares.use("/api/business-catalog", async (request, response, next) => {
        if (request.method === "GET") {
          try {
            const yaml = await fs.readFile(catalogPath, "utf8");
            const catalog = parse(yaml);
            const revision = crypto.createHash("sha256").update(yaml).digest("hex");
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ revision, yaml, catalog, diagnostics: [] }));
          } catch (error) {
            response.statusCode = 500;
            response.end(JSON.stringify({ message: error instanceof Error ? error.message : "Catalog read failed" }));
          }
          return;
        }
        if (request.method !== "PUT") return next();
        let body = "";
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", async () => {
          try {
            const payload = JSON.parse(body || "{}");
            const nextYaml = String(payload.yaml || "");
            const parsed = parse(nextYaml);
            if (!parsed || typeof parsed !== "object" || !parsed.datasets) throw new Error("Catalog must contain datasets");
            const currentYaml = await fs.readFile(catalogPath, "utf8");
            const currentRevision = crypto.createHash("sha256").update(currentYaml).digest("hex");
            const suppliedRevision = request.headers["if-match"] || payload.revision;
            if (suppliedRevision && suppliedRevision !== "local" && suppliedRevision !== currentRevision) {
              response.statusCode = 409;
              response.end(JSON.stringify({ message: "Catalog revision conflict", revision: currentRevision }));
              return;
            }
            const temporaryPath = `${catalogPath}.tmp-${process.pid}`;
            await fs.writeFile(temporaryPath, stringify(parsed), "utf8");
            await fs.rename(temporaryPath, catalogPath);
            const revision = crypto.createHash("sha256").update(nextYaml).digest("hex");
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ revision, yaml: stringify(parsed), catalog: parsed, diagnostics: [] }));
          } catch (error) {
            response.statusCode = 400;
            response.end(JSON.stringify({ message: error instanceof Error ? error.message : "Catalog save failed" }));
          }
        });
      });
    },
  };
}

export default defineConfig({ plugins: [react(), catalogApi()] });
