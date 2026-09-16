import type { Destination } from './navigation'
export type WindowAction = {kind:'navigate';destination:Destination;agent?:import('./agents').AgentId} | {kind:'hide'} | {kind:'quit'}
export interface ActionRequest { id: number; action: WindowAction }
