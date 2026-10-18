import type { Disposable } from './lifecycle.ts'
import { DisposableScope, disposable } from './lifecycle.ts'

export interface Topic<Args extends unknown[]> {
  readonly name: string
  readonly id: symbol
  readonly __args?: Args
}

export function topic<Args extends unknown[]>(name: string): Topic<Args> {
  return { name, id: Symbol(name) }
}

export class MessageBus implements Disposable {
  private readonly subscriptions = new Map<symbol, Set<(...args: unknown[]) => void>>()
  private readonly lifetime = new DisposableScope()

  connect(parent?: DisposableScope): MessageConnection {
    const connection = new MessageConnection(this)
    this.lifetime.add(connection)
    parent?.add(connection)
    return connection
  }

  subscribe<Args extends unknown[]>(topicValue: Topic<Args>, handler: (...args: Args) => void): Disposable {
    const handlers = this.subscriptions.get(topicValue.id) ?? new Set<(...args: unknown[]) => void>()
    const listener = handler as unknown as (...args: unknown[]) => void
    handlers.add(listener)
    this.subscriptions.set(topicValue.id, handlers)
    return disposable(() => {
      handlers.delete(listener)
      if (handlers.size === 0) this.subscriptions.delete(topicValue.id)
    })
  }

  publish<Args extends unknown[]>(topicValue: Topic<Args>, ...args: Args): void {
    const handlers = this.subscriptions.get(topicValue.id)
    if (!handlers) return
    for (const handler of [...handlers]) handler(...args)
  }

  dispose(): void {
    this.lifetime.dispose()
    this.subscriptions.clear()
  }

  disconnect(connection: MessageConnection): void {
    connection.disposeSubscriptions()
  }
}

export class MessageConnection implements Disposable {
  private readonly scope = new DisposableScope()
  private readonly bus: MessageBus

  constructor(bus: MessageBus) {
    this.bus = bus
  }

  subscribe<Args extends unknown[]>(topicValue: Topic<Args>, handler: (...args: Args) => void): Disposable {
    return this.scope.add(this.bus.subscribe(topicValue, handler))
  }

  disposeSubscriptions(): void {
    this.scope.dispose()
  }

  dispose(): void {
    this.bus.disconnect(this)
  }
}
