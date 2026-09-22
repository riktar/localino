import { useRef, useState } from 'react'
import type { LiveSession, SessionInteraction } from '../../../shared/sessions'
import { Button } from './ui/button'

type Answers = Record<string,Record<string,string[]>>
type OtherAnswers = Record<string,Record<string,string>>

const outcome:Record<Exclude<SessionInteraction['resolution'],null>,string>={approved:'Approved once',denied:'Denied',submitted:'Response sent',cancelled:'Cancelled'}

export function SessionInteractions({session,onError,onResolved}:{session:LiveSession;onError:(message:string|undefined)=>void;onResolved:()=>Promise<void>}):React.JSX.Element|null {
  const [answers,setAnswers]=useState<Answers>({}),[other,setOther]=useState<OtherAnswers>({})
  const [localResolution,setLocalResolution]=useState<Record<string,Exclude<SessionInteraction['resolution'],null>>>({}),locks=useRef(new Set<string>())
  if(!session.interactions.length)return null
  const setAnswer=(interactionId:string,questionId:string,value:string[])=>setAnswers(previous=>({...previous,[interactionId]:{...previous[interactionId],[questionId]:value}}))
  const setOtherAnswer=(interactionId:string,questionId:string,value:string)=>setOther(previous=>({...previous,[interactionId]:{...previous[interactionId],[questionId]:value}}))
  const respond=async(interaction:SessionInteraction,action:'approve'|'deny'|'submit'|'cancel')=>{
    if(locks.current.has(interaction.id))return
    locks.current.add(interaction.id)
    const submitted=Object.fromEntries(interaction.questions.map(question=>{
      const selected=answers[interaction.id]?.[question.id]??(question.initialValue!==undefined?[question.initialValue]:[]),custom=other[interaction.id]?.[question.id]?.trim()
      return [question.id,custom?[...selected,custom]:selected]
    }))
    onError(undefined)
    const optimistic=action==='approve'?'approved':action==='deny'?'denied':action==='cancel'?'cancelled':'submitted'
    setLocalResolution(previous=>({...previous,[interaction.id]:optimistic}))
    try{
      const result=await window.localino.respondToSessionInteraction({sessionId:session.id,interactionId:interaction.id,action,...(action==='submit'?{answers:submitted}:{})})
      if(!result.ok){setLocalResolution(previous=>{const next={...previous};delete next[interaction.id];return next});onError(result.error)}
      else await onResolved()
    }finally{locks.current.delete(interaction.id)}
  }
  return <section aria-label={`Actions for ${session.projectName} instance ${session.id.slice(0,8)}`} className="space-y-2">
    {session.interactions.map(interaction=>{const resolved=localResolution[interaction.id]??interaction.resolution,active=interaction.status==='pending'&&!resolved;return <article key={interaction.id} className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3" data-session-interaction={interaction.id}>
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="text-sm font-semibold">{interaction.kind==='unsupported'?'Action required — unsupported in Localino':interaction.title}</h4><p className="text-xs text-muted-foreground">Session {session.id.slice(0,8)}</p></div>{(!active||resolved)&&<span role="status" className="rounded-full bg-muted px-2 py-0.5 text-xs">{resolved?outcome[resolved]:interaction.status}</span>}</div>
      <dl className="mt-2 grid gap-1 text-xs"><div><dt className="inline font-medium">Action: </dt><dd className="inline">{interaction.title}</dd></div><div><dt className="inline font-medium">Risk: </dt><dd className="inline whitespace-pre-wrap break-words">{interaction.detail}</dd></div><div><dt className="inline font-medium">Target: </dt><dd className="inline whitespace-pre-wrap break-words font-mono">{interaction.target}</dd></div></dl>
      {interaction.kind==='input'&&active&&<div className="mt-3 space-y-3">{interaction.questions.map(question=>{
        const selected=answers[interaction.id]?.[question.id]??(question.initialValue!==undefined?[question.initialValue]:[])
        return <div key={question.id} className="space-y-1"><label className="block text-xs font-medium" htmlFor={`${interaction.id}-${question.id}`}>{question.label}</label><p className="text-xs text-muted-foreground">{question.prompt}</p>
          {question.control==='multiline'?<textarea id={`${interaction.id}-${question.id}`} maxLength={100_000} className="min-h-20 w-full resize-y rounded-md border bg-background p-2 text-sm" value={selected[0]??''} onChange={event=>setAnswer(interaction.id,question.id,[event.target.value])}/>:question.control==='choice'&&(question.multiple||!question.allowOther)?<select id={`${interaction.id}-${question.id}`} multiple={question.multiple} className="w-full rounded-md border bg-background p-2 text-sm" value={question.multiple?selected:selected[0]??''} onChange={event=>setAnswer(interaction.id,question.id,question.multiple?Array.from(event.currentTarget.selectedOptions,option=>option.value):[event.currentTarget.value])}><option value="" disabled>Select…</option>{question.options.map(option=><option key={option.label} value={option.label}>{option.description?`${option.label} — ${option.description}`:option.label}</option>)}</select>:<><input id={`${interaction.id}-${question.id}`} maxLength={100_000} list={question.options.length?`${interaction.id}-${question.id}-options`:undefined} className="w-full rounded-md border bg-background p-2 text-sm" value={selected[0]??''} onChange={event=>setAnswer(interaction.id,question.id,[event.target.value])}/>{question.options.length>0&&<datalist id={`${interaction.id}-${question.id}-options`}>{question.options.map(option=><option key={option.label} value={option.label}>{option.description}</option>)}</datalist>}</>}
          {question.multiple&&question.allowOther&&<input aria-label={`Other answer for ${question.label}`} maxLength={100_000} className="w-full rounded-md border bg-background p-2 text-sm" value={other[interaction.id]?.[question.id]??''} onChange={event=>setOtherAnswer(interaction.id,question.id,event.target.value)}/>}</div>
      })}</div>}
      {interaction.error&&<p role="alert" className="mt-2 text-xs text-destructive">{interaction.error}</p>}
      {active&&interaction.kind==='approval'&&<div className="mt-3 flex justify-end gap-2"><Button size="sm" variant="outline" onClick={()=>void respond(interaction,'deny')}>Deny</Button><Button size="sm" onClick={()=>void respond(interaction,'approve')}>Approve once</Button></div>}
      {active&&interaction.kind==='input'&&<div className="mt-3 flex justify-end gap-2">{interaction.cancelable&&<Button size="sm" variant="outline" onClick={()=>void respond(interaction,'cancel')}>Cancel</Button>}<Button size="sm" onClick={()=>void respond(interaction,'submit')}>Submit response</Button></div>}
    </article>})}
  </section>
}
