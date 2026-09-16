export interface Rect { x: number; y: number; width: number; height: number }

/** Clamp after display removal or scale changes as well as when opened from the tray. */
export function panelBounds(area: Rect, current: Rect, anchor?: Rect): Rect {
  const width = Math.min(current.width, area.width)
  const height = Math.min(current.height, area.height)
  const x = anchor ? anchor.x + anchor.width / 2 - width / 2 : current.x
  const y = anchor ? (anchor.y < area.y + area.height / 2 ? anchor.y + anchor.height + 8 : anchor.y - height - 8) : current.y
  return { x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))), width, height }
}
