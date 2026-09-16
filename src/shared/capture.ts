export interface CaptureStatus {
  enabled: boolean
  status: 'starting' | 'ready' | 'error' | 'suspended'
  error?: string
}
export interface CaptureDraft {
  id: number
  text: string
  acquiring: boolean
  message: string
  elapsedMs?: number
  visibleMs?: number
}
export const captureHelp = 'In VS Code imposta Editor: Accessibility Support (editor.accessibilitySupport) su on. Localino non modifica le impostazioni delle altre app.'
export function captureMessage(reason: string): string {
  if (reason === 'ok') return 'Selezione acquisita. Salvataggio automatico…'
  if (reason === 'timeout') return 'Lettura della selezione scaduta. Puoi scrivere o incollare il testo.'
  if (reason === 'limit') return 'La selezione supera 100.000 caratteri. Nessun testo è stato troncato: incolla una selezione più breve.'
  if (reason === 'changed') return 'La finestra di origine è cambiata durante la lettura. Puoi incollare il testo.'
  if (reason === 'empty') return 'Nessuna selezione leggibile. Puoi scrivere o incollare il testo.'
  return 'Componente di cattura non disponibile. Puoi scrivere o incollare il testo e riprovare da Scorciatoie.'
}

export interface CapturedNote { sequence: number; noteId: string; captureId: number; elapsedMs?: number; visibleMs?: number; focusFailed?: boolean }
