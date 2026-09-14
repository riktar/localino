import { useEffect, useState } from 'react'
import type { ConnectionState } from '../../../shared/contracts'

export function useConnection(): ConnectionState {
  const [state, setState] = useState<ConnectionState>({ status: 'disconnected', account: null, error: null })
  useEffect(() => {
    let active = true
    let received = false
    const unsubscribe = window.localino.onConnection(value => { received = true; if (active) setState(value) })
    void window.localino.getConnection().then(value => { if (active && !received) setState(value) })
    return () => { active = false; unsubscribe() }
  }, [])
  return state
}
