import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(appRoot, ".env.local") });
config({ path: path.join(appRoot, "../../.env.local") });

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
