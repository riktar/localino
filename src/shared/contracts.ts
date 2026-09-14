export type ConnectionError = 'cli_missing' | 'cli_invalid' | 'incompatible' | 'unauthenticated' | 'unsupported_auth' | 'timeout' | 'transport' | 'preferences'

export interface Account { email: string | null; plan: string | null }
export interface ConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  account: Account | null
  error: ConnectionError | null
}

export interface LocalinoApi {
  hide: () => void
  getConnection: () => Promise<ConnectionState>
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  rereadAccount: () => Promise<void>
  chooseCodex: () => Promise<void>
  onConnection: (listener: (state: ConnectionState) => void) => () => void
}
