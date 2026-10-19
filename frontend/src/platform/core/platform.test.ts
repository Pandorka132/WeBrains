import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ActionSystem } from './actions.ts'
import { DocumentModel } from './document.ts'
import { EditorModel } from './editor.ts'
import { EditorKeyHandlerRegistry } from './editorCommands.ts'
import { resolveAutoClosingPair } from './editorTyping.ts'
import { extensionPoint, ExtensionRegistry } from './extensions.ts'
import { DisposableScope } from './lifecycle.ts'
import { MessageBus, topic } from './messageBus.ts'
import { LanguageRegistry } from './language.ts'
import { PlatformModule, PlatformProject } from './project.ts'
import { ProjectTemplateRegistry } from './projectTemplates.ts'
import { editorLanguageServices, pluginRuntime, projectTemplates } from '../plugin-system/builtinPlugins.ts'
import { PluginRuntime } from '../plugin-system/runtime.ts'
import { PluginCatalog } from '../plugin-system/plugins.ts'
import { ServiceContainer, serviceKey } from './services.ts'
import { isLikelyBinaryFileName, MemoryFileSystem, normalizeRelativePath } from './vfs.ts'
import { createSampleProject } from '../../workspace/sampleProject.ts'

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
  assert.throws(() => connection.subscribe<[value: string]>(changed, (value: string) => { void value }), /connection is disposed/)
  let duplicateCalls = 0
  const duplicateHandler = (value: string) => { void value; duplicateCalls += 1 }
  const firstSubscription = bus.subscribe<[value: string]>(changed, duplicateHandler)
  const secondSubscription = bus.subscribe<[value: string]>(changed, duplicateHandler)
  firstSubscription.dispose()
  bus.publish(changed, 'duplicate')
  assert.equal(duplicateCalls, 1)
  secondSubscription.dispose()
  bus.publish(changed, 'after-unsubscribe')
  assert.equal(duplicateCalls, 1)
  const failingTopic = topic<[value: number]>('failing')
  let laterSubscriberCalled = false
  bus.subscribe<[value: number]>(failingTopic, () => { throw new Error('subscriber failed') })
  bus.subscribe<[value: number]>(failingTopic, () => { laterSubscriberCalled = true })
  assert.throws(() => bus.publish(failingTopic, 1), AggregateError)
  assert.equal(laterSubscriberCalled, true)
  bus.dispose()
  assert.throws(() => bus.connect(), /bus is disposed/)
  assert.throws(() => bus.publish(changed, 'after-dispose'), /bus is disposed/)
  assert.throws(() => topic('   '), /Topic name must not be empty/)
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
  document.dispose()
  assert.throws(() => document.onChange(() => undefined), /Document is disposed/)
})

test('duplicate document listeners have independent lifetimes', () => {
  const document = new DocumentModel('a')
  let calls = 0
  const listener = () => { calls += 1 }
  const first = document.onChange(listener)
  const second = document.onChange(listener)
  first.dispose()
  document.insert(1, 'b')
  assert.equal(calls, 1)
  second.dispose()
  document.insert(2, 'c')
  assert.equal(calls, 1)
  document.dispose()
})

test('documents normalize line separators to LF', () => {
  const document = new DocumentModel('first\r\nsecond\rthird')
  assert.equal(document.text, 'first\nsecond\nthird')
  const change = document.replace({ startOffset: 5, endOffset: 6 }, '\r\n\r\n')
  assert.equal(change.newText, '\n\n')
  assert.equal(document.text, 'first\n\nsecond\nthird')
})

test('editor caret offsets track document edits', () => {
  const document = new DocumentModel('abcdef')
  const editor = new EditorModel(document)
  editor.setCaretOffset(5)
  document.replace({ startOffset: 1, endOffset: 2 }, 'XYZ')
  assert.equal(editor.caretOffset, 7)
  editor.setCaretOffset(1)
  document.insert(1, '!')
  assert.equal(editor.caretOffset, 2)
  editor.dispose()
})

test('language registrations are immutable snapshots and can be disposed', () => {
  const registry = new LanguageRegistry()
  const extensions = ['.TS', 'tsx']
  const registration = registry.register({ id: 'typescript', displayName: 'TypeScript', fileExtensions: extensions })
  extensions.push('md')
  assert.equal(registry.forFileName('App.TS')?.id, 'typescript')
  assert.equal(registry.forFileName('App.tsx')?.id, 'typescript')
  assert.equal(registry.forFileName('README') , undefined)
  assert.deepEqual(registry.find('typescript')?.fileExtensions, ['ts', 'tsx'])
  assert.throws(() => registry.register({ id: 'javascript', displayName: 'JavaScript', fileExtensions: ['ts'] }), /File extension already registered/)
  assert.throws(() => registry.register({ id: 'unsafe', displayName: 'Unsafe', fileExtensions: ['../unsafe'] }), /invalid/)
  registration.dispose()
  assert.equal(registry.find('typescript'), undefined)
})

test('plugin runtime activates dependencies first and disposes plugin contributions in reverse order', () => {
  const runtime = new PluginRuntime()
  const calls: string[] = []
  runtime.register({ manifest: { id: 'example.main', name: 'Main', version: '1', dependsOn: ['example.dep'] }, activate(context) {
    calls.push('main')
    context.register(() => calls.push('main-dispose'))
  } })
  runtime.register({ manifest: { id: 'example.dep', name: 'Dependency', version: '1' }, activate(context) {
    calls.push('dependency')
    context.register(() => calls.push('dependency-dispose'))
  } })
  assert.deepEqual(runtime.activateAll(), ['example.dep', 'example.main'])
  assert.deepEqual(calls, ['dependency', 'main'])
  assert.throws(() => runtime.register({ manifest: { id: 'late', name: 'Late', version: '1' }, activate() {} }), /after activation/)
  runtime.dispose()
  assert.deepEqual(calls, ['dependency', 'main', 'main-dispose', 'dependency-dispose'])
})

test('plugin runtime rolls back contributions when activation fails', () => {
  const runtime = new PluginRuntime()
  const calls: string[] = []
  runtime.register({ manifest: { id: 'example.first', name: 'First', version: '1' }, activate(context) {
    context.register(() => calls.push('first-dispose'))
  } })
  runtime.register({ manifest: { id: 'example.broken', name: 'Broken', version: '1' }, activate(context) {
    context.register(() => calls.push('broken-dispose'))
    throw new Error('activation failed')
  } })
  assert.throws(() => runtime.activateAll(), /activation failed/)
  assert.deepEqual(calls, ['broken-dispose', 'first-dispose'])
  runtime.dispose()
})

test('bundled Python CE contribution registers project template, code style, and Enter handler', async () => {
  assert.deepEqual(pluginRuntime.activePluginIds(), ['WebBrains', 'PythonCore'])
  assert.equal(projectTemplates.find('python-ce.pure-python')?.pluginId, 'PythonCore')
  assert.equal(projectTemplates.find('webbrains.empty-project')?.pluginId, 'WebBrains')
  assert.equal(projectTemplates.find('webbrains.empty-project')?.files.length, 0)
  assert.equal(editorLanguageServices.forFileName('main.py')?.tabSize, 4)
  assert.deepEqual(editorLanguageServices.forFileName('main.py')?.autoClosingPairs?.map(({ open, close }) => `${open}${close}`), ['()', '[]', '{}', "''", '""'])
  const completionService = editorLanguageServices.forFileName('main.py')?.complete
  assert.ok(completionService)
  const completions = await completionService({
    source: 'greet = 1\ngre', caretOffset: 13, prefix: 'gre', signal: new AbortController().signal,
    tokens: [
      { type: 'Py:IDENTIFIER', start: 0, end: 5, text: 'greet' },
      { type: 'Py:IDENTIFIER', start: 10, end: 13, text: 'gre' },
      { type: 'Py:STRING', start: 14, end: 18, text: 'green' },
    ],
  })
  assert.deepEqual(completions.map(({ label }) => label), ['greet'])
  const edit = pluginRuntime.editorKeyHandlers.dispatch({
    key: 'Enter', filePath: 'main.py', source: 'if True:', caretOffset: 8,
    selection: { startOffset: 8, endOffset: 8 }, shiftKey: false, indentSize: 4,
  })
  assert.equal(edit.text, '\n    ')
  assert.equal(edit.selectionStart, 13)
})

test('editor key handlers dispatch by priority, support fallback, and unregister with disposal', () => {
  const registry = new EditorKeyHandlerRegistry()
  const calls: string[] = []
  registry.register({
    id: 'low', keys: ['Enter'], priority: 1,
    handle: () => { calls.push('low'); return undefined },
  })
  const high = registry.register({
    id: 'high', keys: ['Enter'], priority: 10,
    handle: (context) => {
      calls.push('high')
      return { range: context.selection, text: 'X', selectionStart: context.selection.startOffset + 1, selectionEnd: context.selection.startOffset + 1 }
    },
  })
  const context = { key: 'Enter' as const, filePath: 'note.txt', source: 'abc', caretOffset: 1,
    selection: { startOffset: 1, endOffset: 2 }, shiftKey: false, indentSize: 2 }
  assert.deepEqual(registry.dispatch(context), {
    range: { startOffset: 1, endOffset: 2 }, text: 'X', selectionStart: 2, selectionEnd: 2,
  })
  assert.deepEqual(calls, ['high'])
  high.dispose()
  const fallback = registry.dispatch({ ...context, selection: { startOffset: 1, endOffset: 1 } })
  assert.equal(fallback.text, '\n')
  assert.deepEqual(calls, ['high', 'low'])
  assert.throws(() => registry.register({ id: 'bad', keys: [], handle: () => undefined }), /Invalid editor key handler/)
  assert.throws(() => registry.dispatch({ ...context, caretOffset: 10 }), /Invalid caret offset/)
})

test('platform Tab commands indent selected lines and Shift+Tab unindents them', () => {
  const registry = new EditorKeyHandlerRegistry()
  const context = { key: 'Tab' as const, filePath: 'note.txt', source: 'first\nsecond', caretOffset: 2,
    selection: { startOffset: 0, endOffset: 11 }, shiftKey: false, indentSize: 2 }
  const indented = registry.dispatch(context)
  assert.equal(`${context.source.slice(0, indented.range.startOffset)}${indented.text}${context.source.slice(indented.range.endOffset)}`, '  first\n  second')
  const unindented = registry.dispatch({ ...context, source: '  first\n  second', selection: { startOffset: 0, endOffset: 15 }, shiftKey: true })
  assert.equal(`${'  first\n  second'.slice(0, unindented.range.startOffset)}${unindented.text}${'  first\n  second'.slice(unindented.range.endOffset)}`, 'first\nsecond')
  const singleLine = registry.dispatch({ ...context, source: '    value', caretOffset: 3,
    selection: { startOffset: 3, endOffset: 3 }, shiftKey: true })
  assert.equal(singleLine.text, '  value')
  assert.equal(singleLine.selectionStart, 1)
  assert.equal(singleLine.selectionEnd, 1)
})


test('platform auto-closing inserts language-contributed pairs, wraps selections, skips existing closers, and respects escapes', () => {
  const pairs = [
    { open: '(', close: ')', kind: 'brace' as const },
    { open: '[', close: ']', kind: 'brace' as const },
    { open: "'", close: "'", kind: 'quote' as const },
  ]
  assert.deepEqual(resolveAutoClosingPair('call', { startOffset: 4, endOffset: 4 }, '(', pairs), {
    range: { startOffset: 4, endOffset: 4 }, text: '()', selectionStart: 5, selectionEnd: 5,
  })
  assert.deepEqual(resolveAutoClosingPair('word', { startOffset: 0, endOffset: 4 }, '(', pairs), {
    range: { startOffset: 0, endOffset: 4 }, text: '(word)', selectionStart: 5, selectionEnd: 5,
  })
  assert.equal(resolveAutoClosingPair(')', { startOffset: 0, endOffset: 0 }, ')', pairs)?.skipExistingCloser, true)
  assert.equal(resolveAutoClosingPair('\\', { startOffset: 1, endOffset: 1 }, "'", pairs), undefined)
})

test('project templates validate safe paths, preserve immutable snapshots, and unregister on disposal', () => {
  const registry = new ProjectTemplateRegistry()
  const files = [{ path: 'src/main.py', content: 'print("Hello World")' }]
  const registration = registry.register({ id: 'python.pure', pluginId: 'PythonCore', name: 'Python', description: 'Pure Python', languageId: 'python', files })
  files.push({ path: '../escape.py', content: 'bad' })
  assert.deepEqual(registry.find('python.pure')?.files, [{ path: 'src/main.py', content: 'print("Hello World")' }])
  assert.throws(() => registry.register({ id: 'unsafe', pluginId: 'test', name: 'Unsafe', description: 'Invalid path', files: [{ path: '../escape.py', content: 'bad' }] }), /path|relative|outside/i)
  assert.throws(() => registry.register({ id: 'python.pure', pluginId: 'PythonCore', name: 'Duplicate', description: 'Duplicate', files: [] }), /already registered/)
  registration.dispose()
  assert.equal(registry.find('python.pure'), undefined)
})

test('service containers own disposable services and reject duplicate registrations', () => {
  assert.throws(() => serviceKey('   '), /Service key name must not be empty/)
  const key = serviceKey<{ dispose(): void }>('example')
  const services = new ServiceContainer()
  let disposed = false
  const service = { dispose: () => { disposed = true } }
  services.register(key, service)
  assert.equal(services.get(key), service)
  const undefinedKey = serviceKey<undefined>('intentional-undefined')
  services.register(undefinedKey, undefined)
  assert.equal(services.get(undefinedKey), undefined)
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
  assert.throws(() => project.addModule(new PlatformModule('app')), /Module already exists/)
  const disposedModule = new PlatformModule('disposed')
  disposedModule.dispose()
  assert.throws(() => project.addModule(disposedModule), /Module is already disposed/)

  assert.throws(() => extensionPoint('   '), /Extension point name must not be empty/)
  const point = extensionPoint<{ value: number }>('sample')
  const extensions = new ExtensionRegistry()
  assert.throws(() => extensions.register(point, '   ', { value: 0 }), /Extension id must be a non-empty token/)
  assert.throws(() => extensions.register(point, 'has space', { value: 0 }), /Extension id must be a non-empty token/)
  const registration = extensions.register(point, 'one', { value: 1 })
  assert.deepEqual(extensions.get(point), [{ value: 1 }])
  registration.dispose()
  assert.deepEqual(extensions.get(point), [])

  const actions = new ActionSystem()
  let performed = false
  assert.throws(() => actions.register('   ', { perform: () => undefined }), /Action id must be a non-empty token/)
  actions.register('disabled', {
    update: ({ presentation }) => { presentation.enabled = false },
    perform: () => { performed = true },
  })
  assert.equal(await actions.perform('disabled'), false)
  assert.equal(performed, false)
  const binding = actions.keymap.bind('save', { key: ' S ', modifiers: ['ctrl', 'ctrl'] })
  const shortcuts = actions.keymap.getShortcuts('save')
  assert.deepEqual(shortcuts, [{ key: 'S', modifiers: ['ctrl'] }])
  const exposedModifiers = shortcuts[0].modifiers as ('ctrl' | 'alt' | 'shift' | 'meta')[]
  exposedModifiers.push('alt')
  assert.deepEqual(actions.keymap.getShortcuts('save'), [{ key: 'S', modifiers: ['ctrl'] }])
  assert.throws(() => actions.keymap.bind('save', { key: 'x', modifiers: ['hyper' as 'ctrl'] }), /unsupported modifier/)
  binding.dispose()
  assert.deepEqual(actions.keymap.getShortcuts('save'), [])
  actions.dispose()
  project.dispose()
  assert.equal(project.getModules().length, 0)
})

test('project and module disposal continue after a lifetime cleanup fails', () => {
  const module = new PlatformModule('broken')
  let moduleServiceDisposed = false
  module.services.register(serviceKey<{ dispose(): void }>('module-disposable'), { dispose: () => { moduleServiceDisposed = true } })
  module.lifetime.add(() => { throw new Error('module cleanup failed') })
  assert.throws(() => module.dispose(), AggregateError)
  assert.equal(moduleServiceDisposed, true)

  const project = new PlatformProject('demo', 'Demo')
  let projectServiceDisposed = false
  project.services.register(serviceKey<{ dispose(): void }>('project-disposable'), { dispose: () => { projectServiceDisposed = true } })
  const child = new PlatformModule('child')
  child.lifetime.add(() => { throw new Error('child cleanup failed') })
  project.addModule(child)
  assert.throws(() => project.dispose(), AggregateError)
  assert.equal(projectServiceDisposed, true)
  assert.equal(project.getModules().length, 0)
})

test('memory VFS creates directories, reads files, and returns a snapshot of children', async () => {
  assert.throws(() => new MemoryFileSystem('../outside'), /valid single path segment/)
  assert.throws(() => new MemoryFileSystem('bad\0name'), /valid single path segment/)
  const fs = new MemoryFileSystem()
  const file = fs.writeText('src/main.ts', 'export {}')
  assert.equal(await fs.root.find('/workspace/src/main.ts')?.readText(), 'export {}')
  assert.equal(fs.find('src/main.ts'), file)
  assert.deepEqual(fs.root.children().map((child) => child.name), ['src'])
  fs.deleteEntry('/workspace/src/main.ts')
  assert.equal(fs.find('/workspace/src/main.ts'), undefined)
  fs.deleteEntry('/workspace/src')
  assert.deepEqual(fs.root.children(), [])
  assert.throws(() => fs.deleteEntry('/workspace'), /project root cannot be deleted/)
})

test('binary assets are rejected while common source/text files remain editable', () => {
  assert.equal(isLikelyBinaryFileName('public/logo.png'), true)
  assert.equal(isLikelyBinaryFileName('archive/project.zip'), true)
  assert.equal(isLikelyBinaryFileName('src/App.tsx'), false)
  assert.equal(isLikelyBinaryFileName('public/icon.svg'), false)
  assert.equal(isLikelyBinaryFileName('package-lock.json'), false)
})

test('VFS paths normalize within the root and reject traversal or prefix collisions', () => {
  const fs = new MemoryFileSystem()
  const file = fs.writeText('/workspace/src/../main.ts', 'safe')
  assert.equal(file.path, '/workspace/main.ts')
  assert.equal(fs.find('/workspace/main.ts'), file)
  assert.equal(fs.createDirectory('/workspace/src').path, '/workspace/src')
  fs.writeText('workspace-other/main.ts', 'must not resolve through an absolute prefix collision')
  assert.equal(fs.find('/workspace-other/main.ts'), undefined)
  assert.throws(() => fs.writeText('/workspace-other/evil.ts', 'blocked'), /outside the virtual filesystem root/)
  assert.throws(() => fs.writeText('../outside.ts', 'blocked'), /escapes the virtual filesystem root/)
  assert.throws(() => normalizeRelativePath('/absolute/file.ts'), /project-relative path/)
  assert.throws(() => fs.createDirectory('../../outside'), /escapes the virtual filesystem root/)
  assert.throws(() => fs.root.addFile('nested/file.ts', 'blocked'), /valid single path segment/)
  assert.throws(() => fs.root.addDirectory('..'), /valid single path segment/)
  assert.equal(fs.root.find('../outside.ts'), undefined)
})

test('sample project fixture exposes editable in-memory source files', async () => {
  assert.equal(createSampleProject('toString').id, 'aurora-dashboard')
  assert.equal(createSampleProject('__proto__').name, 'Aurora Dashboard')
  const project = createSampleProject()
  const app = project.files.find('src/App.tsx')
  assert.ok(app && !app.isDirectory)
  const source = await app.readText()
  assert.match(source, /export function App/)
  assert.ok(source.split('\n').length > 5, 'sample source should contain real line breaks, not escaped slash-n text')
  app.write('// updated in memory')
  assert.equal(await app.readText(), '// updated in memory')
  assert.equal(project.files.find('src/styles.css')?.isDirectory, false)
})

test('plugin catalog validates declared dependencies and orders bundled plugins', () => {
  const catalog = new PluginCatalog()
  catalog.register({ id: 'language', name: 'Language Support', version: '1', platformModules: ['platform.psi'] })
  const featureManifest = { id: 'feature', name: 'Feature', version: '1', dependsOn: ['language'] }
  catalog.register(featureManifest)
  featureManifest.dependsOn.push('mutated-after-registration')

  assert.deepEqual(catalog.validate(), [
    { pluginId: 'language', dependencyId: 'platform.psi', kind: 'platform-module' },
  ])
  assert.deepEqual(
    catalog.activationOrder(new Set(['platform.psi'])).map(({ id }) => id),
    ['language', 'feature'],
  )
  assert.throws(() => catalog.activationOrder(), /Unresolved plugin dependencies/)
})
