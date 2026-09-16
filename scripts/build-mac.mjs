import { spawnSync } from 'node:child_process'
if(process.platform!=='darwin')throw Error('Build macOS artifacts on a Mac with the Xcode command line tools.')
const arch=process.argv[2]||process.arch
if(!['arm64','x64'].includes(arch))throw Error('Use arm64 or x64.')
const env={...process.env,LOCALINO_ARCH:arch}
for(const args of [['run','build'],['exec','electron-builder','--','--mac','--'+arch,'--publish','never']]){
  const result=spawnSync('npm',args,{stdio:'inherit',env})
  if(result.error)throw result.error
  if(result.status!==0)process.exit(result.status||1)
}
