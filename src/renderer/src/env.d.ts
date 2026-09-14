import type { LocalinoApi } from '../../shared/contracts'

declare global {
  interface Window { localino: LocalinoApi }
}
