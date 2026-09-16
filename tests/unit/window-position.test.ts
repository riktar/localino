import test from 'node:test'
import assert from 'node:assert/strict'
import { panelBounds } from '../../src/main/window-position'

test('panel stays in the working area after a monitor is removed or the tray moves',()=>{
  const area={x:-1280,y:30,width:1280,height:690}
  const previous={x:4000,y:2500,width:420,height:640}
  assert.deepEqual(panelBounds(area,previous),{x:-420,y:80,width:420,height:640})
  assert.deepEqual(panelBounds(area,previous,{x:-1270,y:0,width:20,height:30}),{x:-1280,y:38,width:420,height:640})
  assert.deepEqual(panelBounds({x:0,y:0,width:320,height:400},previous),{x:0,y:0,width:320,height:400})
})
