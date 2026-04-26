import { config } from 'dotenv'
import { defineConfig } from 'prisma/config'

// Prisma 7 doesn't auto-load .env in prisma.config.ts — load it explicitly
config({ path: '.env.local', override: false })
config({ path: '.env', override: false })

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:placeholder@localhost:5432/sunscan',
  },
})
