// import "dotenv/config";
import { defineConfig } from "prisma/config";

const url = process.env.DATABASE_URL || `postgresql://${encodeURIComponent(process.env.DB_USER || 'inventrops')}:${encodeURIComponent(process.env.DB_PASSWORD || 'inventrops_secret')}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'inventrops'}?schema=public`;

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: url,
  },
});
