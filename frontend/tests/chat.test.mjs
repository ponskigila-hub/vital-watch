import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/chat.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {chatBlocks, cleanChatText, chatSeries} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('chat supports headings, bullets and ordered steps without leaking evidence tags or changing values', () => {
  const blocks = chatBlocks('## Latest readings\n- **Heart rate: 108 bpm** [observation:HR:12, latest:HR]\n- Temperature **36.28 °C**\n\n1. document_assessment [care:abc]\n2. Review [missing readings]')
  assert.deepEqual(blocks.map(b => b.kind), ['heading','bullets','ordered'])
  assert.equal(blocks[1].lines[0], '**Heart rate: 108 bpm**')
  assert.match(blocks[1].lines[1], /36\.28/)
  assert.match(blocks[2].lines[0], /Document an assessment/)
  assert.match(blocks[2].lines[1], /\[missing readings\]/)
  assert.equal(cleanChatText('```text\nHello\\n- Reading\n```'), 'Hello\n- Reading')
  const inline = chatBlocks('Overview. * Heart rate **104 bpm**. * Temperature **36.2 °C**.')
  assert.equal(inline[1].kind, 'bullets')
  assert.equal(inline[1].lines.length, 2)
})
test('charts use referenced snapshot measurements only, preserve zero and gaps, and exclude future and old data', () => {
  const evidence = {
    'observation:HR:2': {hour:2,value:77},
    'observation:HR:27': {hour:27,value:0},
    'observation:HR:29': {hour:29,value:85},
    'observation:HR:31': {hour:31,value:999},
    'observation:Temp:29': {hour:29,value:37},
    'observation:Temp:30': {hour:30,value:38},
  }
  const result = chatSeries(evidence, ['trend:HR'], 30)
  assert.equal(result.length,1)
  assert.deepEqual(result[0].rows,[{hour:27,value:0},{hour:28,value:null},{hour:29,value:85},{hour:30,value:null}])
  assert.deepEqual(chatSeries(evidence,['latest:SBP'],30),[])
})
test('score charts require repeated finite scores and retain the supplied threshold without percentage conversion', () => {
  const evidence = {'prediction:history':[{hour:10,score:0},{hour:11,score:null},{hour:12,score:.0937},{hour:13,score:.9}], 'prediction:current':{sepsis:{alert_threshold:.0937}}}
  const result = chatSeries(evidence,['prediction:history'],12)
  assert.equal(result[0].threshold,.0937)
  assert.deepEqual(result[0].rows,[{hour:10,value:0},{hour:11,value:null},{hour:12,value:.0937}])
  assert.deepEqual(chatSeries({'prediction:history':[{hour:12,score:.1}]},['prediction:history'],12),[])
})
