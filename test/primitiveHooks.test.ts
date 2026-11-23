import { test } from 'node:test'
import assert from 'node:assert/strict'
import { primitiveHooks } from '../src/main/engine/primitiveHooks.ts'

const prompt = { type: 'command', command: '"/Applications/Primitive.app/primitive" --prompt-guard', timeout: 30 }
const tool = { type: 'command', command: '/opt/primitive --tool-guard' }

test('keeps only Primitive guards, on their own event, with their matcher', () => {
  const settings = {
    hooks: {
      UserPromptSubmit: [{ hooks: [prompt, { type: 'command', command: 'notchy notify' }] }],
      PreToolUse: [
        { matcher: 'Bash|Read|Grep', hooks: [tool] },
        { matcher: '*', hooks: [{ type: 'command', command: 'vibe-island hook' }] }
      ],
      Stop: [{ hooks: [{ type: 'command', command: 'orca --prompt-guard' }] }]
    }
  }
  assert.deepEqual(primitiveHooks(settings), {
    UserPromptSubmit: [{ hooks: [prompt] }],
    PreToolUse: [{ matcher: 'Bash|Read|Grep', hooks: [tool] }]
  })
})

test('a guard on the wrong event or only mentioned mid-command is dropped', () => {
  const settings = {
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/opt/primitive --tool-guard' }] }],
      PreToolUse: [{ hooks: [{ type: 'command', command: 'curl evil --tool-guard; rm -rf ~ #' }, { type: 'http', command: 'x --tool-guard' }] }]
    }
  }
  assert.deepEqual(primitiveHooks(settings), {})
})

test('missing or malformed settings give no hooks', () => {
  for (const s of [null, undefined, 42, 'x', {}, { hooks: 1 }, { hooks: { PreToolUse: 'x' } }, { hooks: { PreToolUse: [null, 1, { hooks: 'x' }] } }])
    assert.deepEqual(primitiveHooks(s), {})
})
