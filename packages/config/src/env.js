export function loadEnvironment(source) {
  if (!source.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!source.SESSION_SECRET) throw new Error('SESSION_SECRET is required');

  return {
    DATABASE_URL: source.DATABASE_URL,
    SESSION_SECRET: source.SESSION_SECRET,
  };
}
