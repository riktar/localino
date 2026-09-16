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
export const captureHelp = 'In VS Code set Editor: Accessibility Support (editor.accessibilitySupport) to on. On macOS allow Accessibility and Input Monitoring in System Settings. Localino never changes other apps’ settings.'
export function captureMessage(reason:string):string {
  if(reason==='ok')return 'Saving selection…'
  if(reason==='timeout')return 'Selection timed out. Paste or type the text.'
  if(reason==='limit')return 'Selection exceeds 100,000 characters. Use a shorter selection.'
  if(reason==='changed')return 'The source app changed. Paste the text.'
  if(reason==='empty')return 'No readable selection. Paste or type the text.'
  if(reason==='permissions')return 'Allow Accessibility in System Settings, then retry.'
  if(reason==='input-monitoring')return 'Allow Input Monitoring in System Settings, then retry.'
  if(reason==='protected')return 'Protected fields cannot be captured.'
  return 'Capture unavailable. Paste text or retry in Settings.'
}

export interface CapturedNote { sequence: number; noteId: string; captureId: number; elapsedMs?: number; visibleMs?: number; focusFailed?: boolean }
