import { useEffect, useState } from 'react'
import type { ResourceState, Usage } from '../../../shared/contracts'
export function useUsage(): ResourceState<Usage> {
  const [state,setState] = useState<ResourceState<Usage>>({data:null,lastSuccessAt:null,refreshing:false,stale:false,error:null})
  useEffect(() => {
    let received = false; let active = true
    const off = window.localino.onUsage(value => { received = true; if (active) setState(value) })
    void window.localino.getUsage().then(value => { if (active && !received) setState(value) })
    return () => { active = false; off() }
  },[])
  return state
}
