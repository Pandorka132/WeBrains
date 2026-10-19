import assert from 'node:assert/strict'
import test from 'node:test'
import { appUrl, resolveAppLocation } from './routing.ts'

test('root-hosted routes preserve clean paths and query strings', () => {
  assert.deepEqual(resolveAppLocation('/', '', '', '/'), { pathname: '/', search: '' })
  assert.deepEqual(resolveAppLocation('/ide', '?provider=local&project=demo', '', '/'), {
    pathname: '/ide',
    search: '?provider=local&project=demo',
  })
  assert.equal(appUrl('/ide', '?project=demo', '/'), '/ide?project=demo')
})

test('GitHub Pages subpath routes resolve hash paths and encoded project queries', () => {
  assert.deepEqual(resolveAppLocation('/WeBrains/', '', '#/ide?provider=drive&project=folder%201', '/WeBrains/'), {
    pathname: '/ide',
    search: '?provider=drive&project=folder%201',
  })
  assert.deepEqual(resolveAppLocation('/WeBrains/', '', '', '/WeBrains/'), { pathname: '/', search: '' })
  assert.equal(appUrl('/ide', '?provider=drive&project=folder%201', '/WeBrains/'), '/WeBrains/#/ide?provider=drive&project=folder%201')
  assert.equal(appUrl('/', '', '/WeBrains/'), '/WeBrains/#/')
})
