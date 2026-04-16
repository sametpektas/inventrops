import "dotenv/config";
import { defineConfig } from "prisma/config";

// Read connection components from raw environment, ignoring the un-encoded DATABASE_URL passed by docker
const user = process.env.DB_USER || "inventrops";
const password = process.env.DB_PASSWORD || "inventrops_secret";
const host = "db";
const port = "5432";
const dbName = process.env.DB_NAME || "inventrops";

// Safely reconstruct the URL to prevent connection drops on special characters (like '@' or '#')
const encodedUser = encodeURIComponent(user);
const encodedPassword = encodeURIComponent(password);
const url = `postgresql://${encodedUser}:${encodedPassword}@${host}:${port}/${dbName}?schema=public`;

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: url,
  },
});
