import { PluginRuntime } from './runtime.ts'
/** The production SPA uses statically bundled plugin modules; no JAR loading is implied. */
export const pluginRuntime = new PluginRuntime()
export const projectTemplates = pluginRuntime.projectTemplates
export const editorLanguageServices = pluginRuntime.editorLanguageServices
export const editorKeyHandlers = pluginRuntime.editorKeyHandlers

pluginRuntime.register({
  manifest: { id: 'WebBrains', name: 'WebBrains Core', version: '0.1.0' },
  activate(context) {
    context.register(context.projectTemplates.register({
      id: 'webbrains.empty-project',
      pluginId: 'WebBrains',
      name: 'Empty Project',
      description: 'Create an empty workspace without a configured language or SDK.',
      files: [],
    }))
  },
})

pluginRuntime.register({
  manifest: { id: 'PythonCore', name: 'Python Community Edition', version: '263.7031.23' },
  activate(context) {
    // Transitional adapter only: the original PythonEnterHandler needs IntelliJ's live
    // PSI/editor services and is not yet executable in the browser runtime.
    context.register(context.editorKeyHandlers.register({
      id: 'python-ce.enter',
      keys: ['Enter'],
      priority: 100,
      handle: ({ source, caretOffset, selection }) => {
        const lineStart = source.lastIndexOf('\n', Math.max(0, caretOffset - 1)) + 1
        const beforeCursor = source.slice(lineStart, caretOffset)
        const indentation = beforeCursor.match(/^[ \t]*/)?.[0] ?? ''
        const trimmed = beforeCursor.trimEnd()
        const opensBlock = /^[ \t]*(?:async\s+)?(?:if|elif|else|for|while|try|except|finally|with|def|class|match|case)\b.*:\s*(?:#.*)?$/.test(trimmed)
        const text = `\n${indentation}${opensBlock ? '    ' : ''}`
        const insertionCaret = selection.startOffset + text.length
        return { range: selection, text, selectionStart: insertionCaret, selectionEnd: insertionCaret }
      },
    }))
    context.register(context.editorLanguageServices.register({
      id: 'python',
      fileExtensions: ['py', 'pyi'],
      tabSize: 4,
      complete: async ({ prefix, tokens = [], signal }) => {
        if (!prefix || signal.aborted) return []
        // First browser-safe completion slice: identifiers emitted by the original Python CE lexer.
        // This deliberately does not pretend to provide PSI/type/import-aware Python completion.
        const identifiers = new Map<string, number>()
        for (const token of tokens) {
          if (signal.aborted) return []
          if (!/IDENTIFIER|NAME/.test(token.type) || !/^[A-Za-z_]\w*$/.test(token.text) || !token.text.startsWith(prefix) || token.text === prefix) continue
          identifiers.set(token.text, (identifiers.get(token.text) ?? 0) + 1)
        }
        return [...identifiers].map(([label, count]) => ({ label, detail: count > 1 ? `Current file · ${count} occurrences` : 'Current file', kind: 'variable' as const, priority: count }))
          .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.label.localeCompare(right.label))
          .slice(0, 30)
      },
      // Verified against Python CE 263.7031.23: PyBraceMatcher contributes (), [], {},
      // and PythonQuoteHandler delegates quote tokens to BaseQuoteHandler.
      autoClosingPairs: [
        { open: '(', close: ')', kind: 'brace' },
        { open: '[', close: ']', kind: 'brace' },
        { open: '{', close: '}', kind: 'brace' },
        { open: "'", close: "'", kind: 'quote' },
        { open: '"', close: '"', kind: 'quote' },
      ],
    }))
    context.register(context.projectTemplates.register({
      id: 'python-ce.pure-python',
      pluginId: 'PythonCore',
      name: 'Python',
      description: 'A pure Python project. Interpreter setup and execution are not configured in this browser build.',
      languageId: 'python',
      icon: 'python',
      files: [],
    }))
  },
})

pluginRuntime.activateAll()

/** Disposes the built-in runtime for tests or host shutdown. */
export function disposeBuiltinPluginContributions(): void {
  pluginRuntime.dispose()
}
