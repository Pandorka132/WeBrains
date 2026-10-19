export interface Disposable {
  dispose(): void
}

export type Cleanup = (() => void) | Disposable

function disposeOf(cleanup: Cleanup): void {
  if (typeof cleanup === 'function') cleanup()
  else cleanup.dispose()
}

/** Owns resources and releases them once, in reverse registration order. */
export class DisposableScope implements Disposable {
  private cleanups: Cleanup[] = []
  private disposed = false

  get isDisposed(): boolean {
    return this.disposed
  }

  add<T extends Cleanup>(cleanup: T): T {
    if (this.disposed) disposeOf(cleanup)
    else this.cleanups.push(cleanup)
    return cleanup
  }

  onDispose(callback: () => void): Disposable {
    return this.add(disposable(callback))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const cleanups = this.cleanups.reverse()
    this.cleanups = []
    const errors: unknown[] = []
    for (const cleanup of cleanups) {
      try {
        disposeOf(cleanup)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Errors while disposing scope')
  }
}

export function disposable(callback: () => void): Disposable {
  let active = true
  return {
    dispose() {
      if (!active) return
      active = false
      callback()
    },
  }
}
