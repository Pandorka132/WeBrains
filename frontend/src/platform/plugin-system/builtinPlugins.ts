import { PluginRuntime } from './runtime.ts'
import { diagnosePythonSyntax, disposePythonSyntaxDiagnostics } from './pythonDiagnostics.ts'
import { pythonCeKeywordCompletionContributor } from '../core/pythonCompletion.ts'
import { PYTHON_EXECUTOR_ID, PyodidePythonExecutor, pythonRunConfigurationType } from '../core/pythonExecution.ts'
/** The production SPA uses statically bundled plugin modules; no JAR loading is implied. */
export const pluginRuntime = new PluginRuntime()
export const projectTemplates = pluginRuntime.projectTemplates
export const editorLanguageServices = pluginRuntime.editorLanguageServices
export const editorCompletionContributors = pluginRuntime.editorCompletionContributors
export const editorKeyHandlers = pluginRuntime.editorKeyHandlers
export const runConfigurations = pluginRuntime.runConfigurations
export const pythonExecutor = new PyodidePythonExecutor()

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
    context.register(context.fileTypes.register({ id: 'python-ce.file-type', name: 'Python', extensions: ['py', 'pyi'], languageId: 'python' }))
    context.register(context.editorCompletionContributors.register(pythonCeKeywordCompletionContributor))
    context.register(context.runConfigurations.registerType(pythonRunConfigurationType))
    context.register(context.runConfigurations.registerExecutor(PYTHON_EXECUTOR_ID, pythonExecutor))
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
      diagnose: diagnosePythonSyntax,
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
      description: 'A pure Python project. Run Python files in the browser with Pyodide.',
      languageId: 'python',
      icon: 'python',
      files: [],
    }))
  },
})

pluginRuntime.activateAll()

/** Disposes the built-in runtime for tests or host shutdown. */
export function disposeBuiltinPluginContributions(): void {
  disposePythonSyntaxDiagnostics()
  pluginRuntime.dispose()
}
