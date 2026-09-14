import { useEffect, useState } from 'react'
import type { Quotas, ResourceState } from '../../../shared/contracts'

export function useQuotas(): ResourceState<Quotas> {
  const [state, setState] = useState<ResourceState<Quotas>>({ data: null, lastSuccessAt: null, refreshing: false, stale: false, error: null })
  useEffect(() => {
    let received = false; let active = true
    const off = window.localino.onQuotas(value => { received = true; if (active) setState(value) })
    void window.localino.getQuotas().then(value => { if (active && !received) setState(value) })
    return () => { active = false; off() }
  }, [])
  return state
}
