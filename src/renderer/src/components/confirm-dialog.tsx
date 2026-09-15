import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from './ui/button'

interface Question { title:string; description:string; choices:string[]; resolve:(answer:number)=>void }
function ConfirmDialog({question,close}:{question:Question;close:(answer:number)=>void}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null
    const element = dialog.current!; element.showModal()
    return () => { element.close(); if (origin?.isConnected) origin.focus() }
  }, [])
  return <dialog ref={dialog} aria-labelledby="confirm-title" aria-describedby="confirm-description" onCancel={event => {event.preventDefault();close(question.choices.length-1)}} className="m-auto w-[min(90vw,480px)] rounded-xl border bg-card p-6 text-foreground shadow-xl backdrop:bg-black/30">
    <h2 id="confirm-title" className="text-xl font-semibold">{question.title}</h2><p id="confirm-description" className="my-4 whitespace-pre-wrap text-sm text-muted-foreground">{question.description}</p>
    <div className="flex flex-wrap justify-end gap-2">{question.choices.map((label,index) => <Button key={label} variant={index===question.choices.length-1 ? 'outline' : 'default'} onClick={() => close(index)}>{label}</Button>)}</div>
  </dialog>
}
export function useConfirm(): {ask:(title:string,description:string,choices:string[])=>Promise<number>;dialog:React.JSX.Element|null} {
  const [question,setQuestion] = useState<Question|null>(null)
  const pending = useRef<Question|null>(null)
  const ask = useCallback((title:string,description:string,choices:string[]) => new Promise<number>(resolve => {
    if (pending.current) {resolve(choices.length-1);return}
    const next = {title,description,choices,resolve}; pending.current=next;setQuestion(next)
  }),[])
  const close = (answer:number) => {const current=pending.current;pending.current=null;setQuestion(null);current?.resolve(answer)}
  useEffect(() => () => { const current=pending.current;current?.resolve(current.choices.length-1) },[])
  return {ask,dialog:question ? <ConfirmDialog question={question} close={close} /> : null}
}
