import { ConfigError } from '../types/errors';

export function env(variableName: string, defaultValue?: string): string {
  const value = process.env[variableName];
  if (typeof value !== 'string') {
    if (typeof defaultValue === 'string') {
      return defaultValue;
    }
    throw new ConfigError(`Missing environment variable: ${variableName}`);
  }
  return value;
}
