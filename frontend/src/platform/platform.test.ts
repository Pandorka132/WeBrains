import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ActionSystem } from './actions.ts'
import { DocumentModel } from './document.ts'
import { extensionPoint, ExtensionRegistry } from './extensions.ts'
import { DisposableScope } from './lifecycle.ts'
import { MessageBus, topic } from './messageBus.ts'
import { PlatformModule, PlatformProject } from './project.ts'
import { PluginCatalog } from './plugins.ts'
import { ServiceContainer, serviceKey } from './services.ts'
import { MemoryFileSystem } from './vfs.ts'
import { createSampleProject } from '../workspace/sampleProject.ts'

test('disposable scopes dispose once in reverse order and dispose late additions immediately', () => {
  const scope = new DisposableScope()
  const calls: number[] = []
  scope.add(() => calls.push(1))
  scope.add(() => calls.push(2))
  scope.dispose()
  scope.dispose()
  scope.add(() => calls.push(3))
  assert.deepEqual(calls, [2, 1, 3])
})

test('message subscriptions follow connection and parent lifetimes', () => {
  const bus = new MessageBus()
  const changed = topic<[value: string]>('changed')
  const parent = new DisposableScope()
  const connection = bus.connect(parent)
  const received: string[] = []
  connection.subscribe(changed, (value) => received.push(value))
  bus.publish(changed, 'before')
  parent.dispose()
  bus.publish(changed, 'after')
  assert.deepEqual(received, ['before'])
})

test('document edits validate ranges, version changes, and unsubscribe on lifetime disposal', () => {
  const document = new DocumentModel('abc')
  const lifetime = new DisposableScope()
  const versions: number[] = []
  document.onChange((change) => versions.push(change.version), lifetime)
  document.replace({ startOffset: 1, endOffset: 2 }, 'XYZ')
  lifetime.dispose()
  document.insert(0, '!')
  assert.equal(document.text, '!aXYZc')
  assert.deepEqual(versions, [1])
  assert.equal(document.version, 2)
  assert.throws(() => document.delete({ startOffset: -1, endOffset: 0 }), RangeError)
})

test('service containers own disposable services and reject duplicate registrations', () => {
  const key = serviceKey<{ dispose(): void }>('example')
  const services = new ServiceContainer()
  let disposed = false
  const service = { dispose: () => { disposed = true } }
  services.register(key, service)
  assert.equal(services.get(key), service)
  assert.throws(() => services.register(key, service), /already registered/)
  services.dispose()
  assert.equal(disposed, true)
  assert.equal(services.find(key), undefined)
})

test('project owns modules, extensions are disposable, and actions respect presentation state', async () => {
  const project = new PlatformProject('demo', 'Demo')
  const module = new PlatformModule('app')
  project.addModule(module)
  assert.equal(project.findModule('app'), module)

  const point = extensionPoint<{ value: number }>('sample')
  const extensions = new ExtensionRegistry()
  const registration = extensions.register(point, 'one', { value: 1 })
  assert.deepEqual(extensions.get(point), [{ value: 1 }])
  registration.dispose()
  assert.deepEqual(extensions.get(point), [])

  const actions = new ActionSystem()
  let performed = false
  actions.register('disabled', {
    update: ({ presentation }) => { presentation.enabled = false },
    perform: () => { performed = true },
  })
  assert.equal(await actions.perform('disabled'), false)
  assert.equal(performed, false)
  actions.dispose()
  project.dispose()
  assert.equal(project.getModules().length, 0)
})

test('memory VFS creates directories, reads files, and returns a snapshot of children', async () => {
  const fs = new MemoryFileSystem()
  const file = fs.writeText('src/main.ts', 'export {}')
  assert.equal(await fs.root.find('/workspace/src/main.ts')?.readText(), 'export {}')
  assert.equal(fs.find('src/main.ts'), file)
  assert.deepEqual(fs.root.children().map((child) => child.name), ['src'])
})

test('sample project fixture exposes editable in-memory source files', async () => {
  const project = createSampleProject()
  const app = project.files.find('src/App.tsx')
  assert.ok(app && !app.isDirectory)
  assert.match(await app.readText(), /export function App/)
  app.write('// updated in memory')
  assert.equal(await app.readText(), '// updated in memory')
  assert.equal(project.files.find('src/styles.css')?.isDirectory, false)
})

test('plugin catalog validates declared dependencies and orders bundled plugins', () => {
  const catalog = new PluginCatalog()
  catalog.register({ id: 'language', name: 'Language Support', version: '1', platformModules: ['platform.psi'] })
  catalog.register({ id: 'feature', name: 'Feature', version: '1', dependsOn: ['language'] })

  assert.deepEqual(catalog.validate(), [
    { pluginId: 'language', dependencyId: 'platform.psi', kind: 'platform-module' },
  ])
  assert.deepEqual(
    catalog.activationOrder(new Set(['platform.psi'])).map(({ id }) => id),
    ['language', 'feature'],
  )
  assert.throws(() => catalog.activationOrder(), /Unresolved plugin dependencies/)
})
