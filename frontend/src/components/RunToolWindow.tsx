import { useState } from 'react'
import type { ExecutionEvent, ExecutionStatus } from '../platform/core/execution.ts'

export type RunConsoleEntry = { stream: 'stdout' | 'stderr' | 'system' | 'stdin'; text: string }

export function RunToolWindow({ status, statusMessage, entries, inputRequest, hasConfiguration, onStop, onRerun, onInput }: {
  configurationName: string; configurationIcon?: string; status: ExecutionStatus | 'idle'; statusMessage?: string; entries: readonly RunConsoleEntry[]
  inputRequest?: Extract<ExecutionEvent, { type: 'input-request' }>; hasConfiguration: boolean; onStop(): void; onRerun(): void
  onInput(value: string | null): void
}) {
  const [input, setInput] = useState('')
  const busy = status === 'starting' || status === 'running' || status === 'waiting-input'
  const statusLabel = status === 'idle' ? 'Ready' : status === 'waiting-input' ? 'Waiting for input' : status[0].toUpperCase() + status.slice(1)
  return <div className="run-tool-window">
    <div className="run-console-toolbar" role="toolbar" aria-label="Run toolbar">
      <button type="button" className="run-console-action" aria-label="Rerun" title="Rerun (Ctrl+F5)" disabled={!hasConfiguration} onClick={onRerun}><img src={`${import.meta.env.BASE_URL}icons/intellij/run-action.svg`} alt="" aria-hidden="true" /></button>
      <button type="button" className="run-console-action" aria-label="Stop" title="Stop (Ctrl+F2)" disabled={!busy} onClick={onStop}><span className="run-stop-square" /></button>
      <span className="run-toolbar-divider" />
      <span className="run-console-status" data-status={status}>{statusLabel}</span>
    </div>
    <div className="run-console-output" role="log" aria-live="polite" aria-label="Run output">
      {entries.length === 0 && <div className="run-console-empty" role="status">{!hasConfiguration
        ? 'Select or create a run configuration in the main toolbar.'
        : status === 'starting'
          ? statusMessage || 'Starting Python runtime…'
          : status === 'running'
            ? statusMessage || 'Python is running. Waiting for output…'
            : status === 'waiting-input'
              ? statusMessage || 'Waiting for program input…'
              : status === 'completed'
                ? 'Process finished without producing output.'
                : status === 'failed'
                  ? 'Python failed before producing output. Check the error details above or the browser console.'
                  : status === 'stopped'
                    ? 'Process stopped before producing output.'
                    : 'Run the selected configuration to see its output here.'}</div>}
      {entries.map((entry, index) => <div className={`run-console-line run-console-${entry.stream}`} key={`${index}:${entry.text}`}><pre>{entry.text}</pre></div>)}
      {inputRequest && <div className="run-input-row"><span>{inputRequest.prompt || 'Input'}</span>{inputRequest.available ? <form onSubmit={(event) => { event.preventDefault(); onInput(input); setInput('') }}><input aria-label="Program input" autoFocus value={input} onChange={(event) => setInput(event.target.value)} /><button type="submit">Send</button><button type="button" onClick={() => onInput(null)}>EOF</button></form> : <span className="run-input-unavailable">Interactive input requires cross-origin isolation headers (COOP/COEP) on this static host.</span>}</div>}
    </div>
  </div>
}
