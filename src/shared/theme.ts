export type Theme = 'system' | 'light' | 'dark'
export interface ThemeState { preference: Theme; error?: string }
export function isTheme(value: unknown): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark'
}
