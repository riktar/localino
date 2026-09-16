export const destinations = ['panel', 'usage', 'settings'] as const
export type Destination = typeof destinations[number]
export const destinationLabels: Record<Destination, string> = { panel: 'Localino', usage: 'Usage', settings: 'Settings' }
export function isDestination(value: unknown): value is Destination {
  return typeof value === 'string' && destinations.includes(value as Destination)
}
