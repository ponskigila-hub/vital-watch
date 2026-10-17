import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'

// Exercise the pure display calculations without a browser or duplicated JS implementation.
const source = await readFile(new URL('../src/sepsis.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {scoreSummary, reviewState, vitalChanges} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const patient = (overrides={}) => ({id:'p',prediction:{as_of_hour:12,sepsis:{score:.15,alert_threshold:.1}},score_history:[{ICULOS:6,score:0,threshold:.1},{ICULOS:10,score:.12,threshold:.1},{ICULOS:11,score:.13,threshold:.1},{ICULOS:12,score:.15,threshold:.1}],readings:[],...overrides})

test('zero historical scores remain valid and exact six-hour changes are compared',()=>{
  const result=scoreSummary(patient())
  assert.equal(result.delta6,.15)
  assert.equal(result.above,3)
  assert.equal(result.valid.length,4)
  assert.equal(result.consecutive,3)
  assert.ok(Math.abs(result.ratio - 1.5) < 1e-12)
})
test('missing score hours interrupt a run and do not imply a six-hour comparison',()=>{
  const result=scoreSummary(patient({score_history:[{ICULOS:10,score:.2,threshold:.1},{ICULOS:12,score:.15,threshold:.1}]}))
  assert.equal(result.consecutive,1)
  assert.equal(result.delta6,null)
  assert.equal(result.above,2)
})
test('future and out-of-window scores cannot affect peak or time above threshold',()=>{
  const result=scoreSummary(patient({prediction:{as_of_hour:30,sepsis:{score:.02,alert_threshold:.1}},score_history:[{ICULOS:6,score:.9},{ICULOS:7,score:.03},{ICULOS:30,score:.02},{ICULOS:31,score:1}]}))
  assert.equal(result.peak.score,.03)
  assert.equal(result.peak.ICULOS,7)
  assert.equal(result.above,0)
  assert.equal(result.valid.length,2)
})
test('a missing current score is not zero or an improving six-hour change',()=>{
  const base=patient();base.prediction.sepsis.score=null
  assert.equal(scoreSummary(base).score,null)
  assert.equal(scoreSummary(base).delta6,null)
  assert.equal(scoreSummary(base).ratio,null)
})
test('pending alerts survive a lower score and stay separate from acknowledgement',()=>{
  const alerts=[{id:'open',patientId:'p',hour:8,status:'Open'},{id:'ack',patientId:'p',hour:7,status:'Acknowledged'},{id:'resolved',patientId:'p',hour:6,status:'Resolved'},{id:'future',patientId:'p',hour:13,status:'Open'},{id:'other',patientId:'other',hour:7,status:'Open'}]
  const result=reviewState(alerts,'p',12)
  assert.deepEqual(result.pending.map(a=>a.id),['ack','open'])
  assert.deepEqual(result.unacknowledged.map(a=>a.id),['open'])
  assert.deepEqual(result.acknowledged.map(a=>a.id),['ack'])
})
test('observation comparisons retain missingness, measured zeros, and the replay cutoff',()=>{
  const result=vitalChanges(patient({readings:[{ICULOS:1,HR:0,O2Sat:null},{ICULOS:6,HR:10,O2Sat:null},{ICULOS:7,HR:20,O2Sat:95},{ICULOS:12,HR:30,O2Sat:97},{ICULOS:13,HR:999,O2Sat:1}]}))
  assert.deepEqual(result.find(r=>r.key==='HR'),{key:'HR',delta:20,previous:5,current:25,previousCount:2,currentCount:2})
  assert.equal(result.find(r=>r.key==='O2Sat').delta,null)
})
