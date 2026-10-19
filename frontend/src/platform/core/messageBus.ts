import type { Disposable } from './lifecycle.ts'
import { DisposableScope, disposable } from './lifecycle.ts'

export interface Topic<Args extends unknown[]> {
  readonly name: string
  readonly id: symbol
  readonly __args?: Args
}

export function topic<Args extends unknown[]>(name: string): Topic<Args> {
  const cleanName = name.trim()
  if (!cleanName) throw new Error('Topic name must not be empty')
  return { name: cleanName, id: Symbol(cleanName) }
}

export class MessageBus implements Disposable {
  private readonly subscriptions = new Map<symbol, Set<{ handler: (...args: unknown[]) => void }>>()
  private readonly connections = new Set<MessageConnection>()
  private disposed = false

  connect(parent?: DisposableScope): MessageConnection {
    this.assertActive()
    const connection = new MessageConnection(this)
    this.connections.add(connection)
    parent?.add(connection)
    return connection
  }

  subscribe<Args extends unknown[]>(topicValue: Topic<Args>, handler: (...args: Args) => void): Disposable {
    this.assertActive()
    const handlers = this.subscriptions.get(topicValue.id) ?? new Set<{ handler: (...args: unknown[]) => void }>()
    const subscription = { handler: handler as unknown as (...args: unknown[]) => void }
    handlers.add(subscription)
    this.subscriptions.set(topicValue.id, handlers)
    return disposable(() => {
      handlers.delete(subscription)
      if (handlers.size === 0) this.subscriptions.delete(topicValue.id)
    })
  }

  publish<Args extends unknown[]>(topicValue: Topic<Args>, ...args: Args): void {
    this.assertActive()
    const handlers = this.subscriptions.get(topicValue.id)
    if (!handlers) return
    const errors: unknown[] = []
    for (const subscription of [...handlers]) {
      if (!handlers.has(subscription)) continue
      try { subscription.handler(...args) } catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, `Errors while publishing topic ${topicValue.name}`)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const connection of [...this.connections]) connection.dispose()
    this.connections.clear()
    this.subscriptions.clear()
  }

  disconnect(connection: MessageConnection): void {
    this.connections.delete(connection)
    connection.disposeSubscriptions()
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Message bus is disposed')
  }
}

export class MessageConnection implements Disposable {
  private readonly scope = new DisposableScope()
  private readonly bus: MessageBus

  constructor(bus: MessageBus) {
    this.bus = bus
  }

  subscribe<Args extends unknown[]>(topicValue: Topic<Args>, handler: (...args: Args) => void): Disposable {
    if (this.scope.isDisposed) throw new Error('Message connection is disposed')
    return this.scope.add(this.bus.subscribe(topicValue, handler))
  }

  disposeSubscriptions(): void {
    this.scope.dispose()
  }

  dispose(): void {
    this.bus.disconnect(this)
  }
}
