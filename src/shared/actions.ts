import type { Destination } from './navigation'
export type WindowAction = {kind:'navigate';destination:Destination} | {kind:'hide'} | {kind:'quit'}
export interface ActionRequest { id: number; action: WindowAction }
