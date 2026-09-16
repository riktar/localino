import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
const schema=JSON.parse(readFileSync(new URL('./opencode-schema.json',import.meta.url),'utf8'))
export function fixture(path,now=Date.now()) {
  const db=new DatabaseSync(path)
  for(const table of schema)db.exec(table.sql)
  db.prepare('INSERT INTO project(id,worktree,time_created,time_updated,sandboxes) VALUES(?,?,?,?,?)').run('project','synthetic',now,now,'[]')
  const insert=db.prepare('INSERT INTO session(id,project_id,slug,directory,title,version,time_created,time_updated,tokens_input,tokens_output,tokens_reasoning,tokens_cache_read,tokens_cache_write,cost) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  const add=(id,updated,input=0,output=0,reasoning=0,read=0,write=0,cost=0,title='PRIVATE-SENTINEL')=>insert.run(id,'project',id,'synthetic',title,'1.18.31',now-40*86400000,updated,input,output,reasoning,read,write,cost)
  add('recent',now,100,20,3,7,5,0.42)
  add('old',now-40*86400000,10,2,0,1,0,0.10)
  return {db,add}
}
