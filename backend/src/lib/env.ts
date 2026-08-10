import { z } from 'zod';

/**
 * Every secret this app needs, validated in one place.
 *
 * Validation is lazy (on first call) rather than at import time so that `next build` can
 * compile without a database — the build machine doesn't need real credentials, only the
 * running server does.
 */
const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, 'is missing — add your Neon pooled connection string to .env.local'),
  API_SECRET: z
    .string()
    .min(16, 'must be at least 16 characters — generate one with `openssl rand -base64 32`'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    API_SECRET: process.env.API_SECRET,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')} ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}
