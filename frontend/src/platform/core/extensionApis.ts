import type { TextRange } from './document.ts'
import type { Disposable } from './lifecycle.ts'
import { disposable } from './lifecycle.ts'
import type { EditorDiagnostic } from './editorServices.ts'
import type { VirtualFileSystem } from './vfs.ts'

export interface IdentifiedContribution { readonly id: string }

/** Ordered, disposable registry for browser-native plugin extension contracts. */
export class ContributionRegistry<T extends IdentifiedContribution> {
  private readonly entries = new Map<string, { value: T; order: number }>()
  private order = 0

  register(value: T): Disposable {
    const id = value.id.trim()
    if (!id || /\s/.test(id)) throw new Error('Contribution id must be a non-empty token')
    if (this.entries.has(id)) throw new Error(`Contribution already registered: ${id}`)
    const snapshot = Object.freeze({ ...value, id }) as T
    const entry = { value: snapshot, order: this.order++ }
    this.entries.set(id, entry)
    return disposable(() => { if (this.entries.get(id) === entry) this.entries.delete(id) })
  }

  find(id: string): T | undefined { return this.entries.get(id.trim())?.value }
  all(): readonly T[] { return [...this.entries.values()].sort((a, b) => a.order - b.order).map(({ value }) => value) }
  clear(): void { this.entries.clear() }
}

export interface FileTypeContribution extends IdentifiedContribution {
  readonly name: string
  readonly extensions: readonly string[]
  readonly languageId?: string
  readonly isBinary?: boolean
}

export interface PsiNode extends IdentifiedContribution {
  readonly type: string
  readonly range: TextRange
  readonly text: string
  readonly children: readonly PsiNode[]
}

export interface ParserDefinitionContribution extends IdentifiedContribution {
  readonly languageId: string
  parse(source: string, signal: AbortSignal): Promise<PsiNode> | PsiNode
}

export interface InspectionContext {
  readonly languageId: string
  readonly filePath: string
  readonly source: string
  readonly root?: PsiNode
  readonly signal: AbortSignal
}
export interface InspectionContribution extends IdentifiedContribution {
  readonly languageId: string
  readonly displayName: string
  inspect(context: InspectionContext): Promise<readonly EditorDiagnostic[]> | readonly EditorDiagnostic[]
}

export interface WorkspaceEdit { readonly filePath: string; readonly range: TextRange; readonly replacement: string; readonly expectedVersion?: number }
export interface IntentionContext extends InspectionContext { readonly offset: number; readonly diagnostic?: EditorDiagnostic }
export interface IntentionContribution extends IdentifiedContribution {
  readonly languageId: string
  readonly text: string
  isAvailable(context: IntentionContext): boolean | Promise<boolean>
  invoke(context: IntentionContext): Promise<readonly WorkspaceEdit[]> | readonly WorkspaceEdit[]
}

export interface DocumentationContext { readonly languageId: string; readonly source: string; readonly offset: number; readonly root?: PsiNode; readonly signal: AbortSignal }
export interface DocumentationContribution extends IdentifiedContribution {
  readonly languageId: string
  documentation(context: DocumentationContext): string | undefined | Promise<string | undefined>
}

export interface FormatterContext { readonly filePath: string; readonly source: string; readonly signal: AbortSignal }
export interface FormatterContribution extends IdentifiedContribution {
  readonly languageId: string
  format(context: FormatterContext): string | Promise<string>
}

export interface NavigationTarget { readonly filePath: string; readonly range: TextRange; readonly name?: string }
export interface NavigationContext { readonly filePath: string; readonly source: string; readonly offset: number; readonly files: VirtualFileSystem; readonly signal: AbortSignal }
export interface NavigationContribution extends IdentifiedContribution {
  readonly languageId: string
  declaration(context: NavigationContext): NavigationTarget | undefined | Promise<NavigationTarget | undefined>
  references?(context: NavigationContext): readonly NavigationTarget[] | Promise<readonly NavigationTarget[]>
}

export interface LiveTemplateContribution extends IdentifiedContribution {
  readonly languageId?: string
  readonly abbreviation: string
  readonly description: string
  readonly template: string
  readonly contextIds: readonly string[]
}

export interface ToolWindowContribution extends IdentifiedContribution {
  readonly title: string
  readonly anchor: 'left' | 'right' | 'bottom'
  readonly icon?: string
  readonly component: unknown
}

export interface SettingsPageContribution extends IdentifiedContribution {
  readonly title: string
  readonly scope: 'application' | 'project'
  readonly component: unknown
}

export interface RunLineMarkerContribution extends IdentifiedContribution {
  readonly languageId: string
  findTargets(context: { readonly filePath: string; readonly source: string; readonly root?: PsiNode; readonly signal: AbortSignal }): readonly NavigationTarget[] | Promise<readonly NavigationTarget[]>
}

export function findFileType(registry: ContributionRegistry<FileTypeContribution>, filePath: string): FileTypeContribution | undefined {
  const name = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  return registry.all().find((fileType) => fileType.extensions.some((extension) => name.endsWith(`.${extension.toLowerCase().replace(/^\.+/, '')}`)))
}

export async function parseWithPlugin(
  registry: ContributionRegistry<ParserDefinitionContribution>, languageId: string, source: string, signal: AbortSignal,
): Promise<PsiNode | undefined> {
  if (signal.aborted) return undefined
  const parser = registry.all().find((candidate) => candidate.languageId === languageId)
  if (!parser) return undefined
  const root = await parser.parse(source, signal)
  if (signal.aborted) return undefined
  validatePsiNode(root, source.length)
  return root
}

export async function collectInspectionDiagnostics(
  registry: ContributionRegistry<InspectionContribution>, context: InspectionContext,
): Promise<readonly EditorDiagnostic[]> {
  if (context.signal.aborted) return []
  const results = await Promise.all(registry.all().filter((inspection) => inspection.languageId === context.languageId).map((inspection) => inspection.inspect(context)))
  if (context.signal.aborted) return []
  return results.flat().filter((diagnostic) => Number.isInteger(diagnostic.startOffset)
    && Number.isInteger(diagnostic.endOffset) && diagnostic.startOffset >= 0
    && diagnostic.endOffset >= diagnostic.startOffset && diagnostic.endOffset <= context.source.length
    && typeof diagnostic.message === 'string' && diagnostic.message.length > 0)
}

export async function collectAvailableIntentions(
  registry: ContributionRegistry<IntentionContribution>, languageId: string, context: IntentionContext,
): Promise<readonly IntentionContribution[]> {
  if (context.signal.aborted) return []
  const candidates = registry.all().filter((item) => item.languageId === languageId)
  const available = await Promise.all(candidates.map(async (item) => ({ item, available: await item.isAvailable(context) })))
  return context.signal.aborted ? [] : available.filter(({ available: isAvailable }) => isAvailable).map(({ item }) => item)
}

export async function resolveDocumentation(
  registry: ContributionRegistry<DocumentationContribution>, context: DocumentationContext,
): Promise<string | undefined> {
  if (context.signal.aborted) return undefined
  for (const provider of registry.all()) {
    if (provider.languageId !== context.languageId) continue
    const result = await provider.documentation(context)
    if (context.signal.aborted) return undefined
    if (result) return result
  }
  return undefined
}

export async function formatWithPlugin(
  registry: ContributionRegistry<FormatterContribution>, languageId: string, context: FormatterContext,
): Promise<string | undefined> {
  if (context.signal.aborted) return undefined
  const formatter = registry.all().find((candidate) => candidate.languageId === languageId)
  if (!formatter) return undefined
  const result = await formatter.format(context)
  if (context.signal.aborted) return undefined
  if (typeof result !== 'string') throw new TypeError(`Formatter ${formatter.id} returned a non-string result`)
  return result
}

export async function resolveNavigationTarget(
  registry: ContributionRegistry<NavigationContribution>, languageId: string, context: NavigationContext,
): Promise<NavigationTarget | undefined> {
  if (context.signal.aborted) return undefined
  for (const navigator of registry.all()) {
    if (navigator.languageId !== languageId) continue
    const target = await navigator.declaration(context)
    if (context.signal.aborted) return undefined
    if (target) return target
  }
  return undefined
}

function validatePsiNode(node: PsiNode, sourceLength: number): void {
  const visit = (current: PsiNode, parentRange?: TextRange): void => {
    if (!current.id.trim() || !current.type.trim()) throw new Error('PSI nodes require id and type')
    const { startOffset, endOffset } = current.range
    if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset) || startOffset < 0 || endOffset < startOffset || endOffset > sourceLength) {
      throw new RangeError(`Invalid PSI range for ${current.id}: ${startOffset}..${endOffset}`)
    }
    if (parentRange && (startOffset < parentRange.startOffset || endOffset > parentRange.endOffset)) {
      throw new RangeError(`PSI child ${current.id} is outside its parent range`)
    }
    if (typeof current.text !== 'string' || !Array.isArray(current.children)) throw new TypeError(`Invalid PSI node: ${current.id}`)
    for (const child of current.children) visit(child, current.range)
  }
  visit(node)
}

