export const destinations = ['home', 'consumi', 'clipboard', 'shortcuts'] as const
export type Destination = typeof destinations[number]
export const destinationLabels: Record<Destination, string> = { home: 'Home', consumi: 'Consumi', clipboard: 'Clipboard', shortcuts: 'Scorciatoie' }
export function isDestination(value: unknown): value is Destination {
  return typeof value === 'string' && destinations.includes(value as Destination)
}
