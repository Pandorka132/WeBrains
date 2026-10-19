import { disposable } from './lifecycle.ts'
import type { Disposable } from './lifecycle.ts'
import { normalizeRelativePath } from './vfs.ts'

export interface ProjectTemplateFile {
  readonly path: string
  readonly content: string
}

/** A statically bundled plugin contribution to the New Project wizard. */
export interface ProjectTemplate {
  readonly id: string
  readonly pluginId: string
  readonly name: string
  readonly description: string
  readonly languageId?: string
  readonly icon?: string
  readonly files: readonly ProjectTemplateFile[]
}

export class ProjectTemplateRegistry {
  private readonly templates = new Map<string, ProjectTemplate>()

  register(template: ProjectTemplate): Disposable {
    const id = template.id.trim()
    const pluginId = template.pluginId.trim()
    const name = template.name.trim()
    const description = template.description.trim()
    if (!id || /\s/.test(id) || !pluginId || /\s/.test(pluginId) || !name || !description) {
      throw new Error('Project template id, plugin id, name, and description are required')
    }
    if (this.templates.has(id)) throw new Error(`Project template already registered: ${id}`)
    const paths = new Set<string>()
    const files = template.files.map(({ path, content }) => {
      const normalized = normalizeRelativePath(path).join('/')
      if (!normalized || normalized !== path || typeof content !== 'string') throw new Error(`Invalid project template file path: ${path}`)
      if (paths.has(normalized)) throw new Error(`Duplicate project template file: ${normalized}`)
      paths.add(normalized)
      return Object.freeze({ path: normalized, content })
    })
    const snapshot: ProjectTemplate = Object.freeze({ ...template, id, pluginId, name, description, files: Object.freeze(files) })
    this.templates.set(id, snapshot)
    return disposable(() => { if (this.templates.get(id) === snapshot) this.templates.delete(id) })
  }

  find(id: string): ProjectTemplate | undefined {
    return this.templates.get(id)
  }

  all(): readonly ProjectTemplate[] {
    return [...this.templates.values()]
  }
}
