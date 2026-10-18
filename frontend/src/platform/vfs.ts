export interface VirtualFile {
  readonly name: string
  readonly path: string
  readonly isDirectory: boolean
  readonly parent?: VirtualDirectory
  readText(): Promise<string>
}

export interface VirtualDirectory extends VirtualFile {
  readonly isDirectory: true
  children(): readonly VirtualFile[]
  find(path: string): VirtualFile | undefined
}

/** A small in-memory VFS. Host file access must be granted separately by the browser. */
export class MemoryFileSystem {
  readonly root: MemoryDirectory

  constructor(rootName = 'workspace') {
    this.root = new MemoryDirectory(rootName, `/${rootName}`)
  }

  createDirectory(path: string): MemoryDirectory {
    const segments = normalizePath(path)
    let current = this.root
    for (const segment of segments) {
      const existing = current.child(segment)
      if (existing) {
        if (!(existing instanceof MemoryDirectory)) throw new Error(`${segment} is a file`)
        current = existing
      } else {
        current = current.addDirectory(segment)
      }
    }
    return current
  }

  writeText(path: string, text: string): MemoryFile {
    const segments = normalizePath(path)
    const name = segments.pop()
    if (!name) throw new Error('File path must name a file')
    const directory = this.createDirectory(segments.join('/'))
    return directory.addFile(name, text)
  }

  find(path: string): MemoryFile | MemoryDirectory | undefined {
    return this.root.find(path)
  }
}

export class MemoryDirectory implements VirtualDirectory {
  private readonly entries = new Map<string, MemoryFile | MemoryDirectory>()
  readonly isDirectory = true
  readonly name: string
  readonly path: string
  readonly parent?: MemoryDirectory

  constructor(name: string, path: string, parent?: MemoryDirectory) {
    this.name = name
    this.path = path
    this.parent = parent
  }

  async readText(): Promise<string> {
    throw new Error('Cannot read text from a directory')
  }

  children(): readonly (MemoryFile | MemoryDirectory)[] {
    return [...this.entries.values()]
  }

  child(name: string): MemoryFile | MemoryDirectory | undefined {
    return this.entries.get(name)
  }

  find(path: string): MemoryFile | MemoryDirectory | undefined {
    const relative = path.startsWith(this.path) ? path.slice(this.path.length) : path
    return normalizePath(relative).reduce<MemoryFile | MemoryDirectory | undefined>(
      (current, segment) => current instanceof MemoryDirectory ? current.child(segment) : undefined,
      this,
    )
  }

  addDirectory(name: string): MemoryDirectory {
    this.assertNameAvailable(name)
    const directory = new MemoryDirectory(name, `${this.path}/${name}`, this)
    this.entries.set(name, directory)
    return directory
  }

  addFile(name: string, text: string): MemoryFile {
    const current = this.entries.get(name)
    if (current instanceof MemoryDirectory) throw new Error(`${name} is a directory`)
    if (current) {
      current.write(text)
      return current
    }
    const file = new MemoryFile(name, `${this.path}/${name}`, text, this)
    this.entries.set(name, file)
    return file
  }

  private assertNameAvailable(name: string): void {
    if (!name || name.includes('/')) throw new Error('Entry name must be a single path segment')
    if (this.entries.has(name)) throw new Error(`Entry already exists: ${name}`)
  }
}

export class MemoryFile implements VirtualFile {
  readonly isDirectory = false
  readonly name: string
  readonly path: string
  readonly parent: MemoryDirectory
  private content: string

  constructor(name: string, path: string, content: string, parent: MemoryDirectory) {
    this.name = name
    this.path = path
    this.content = content
    this.parent = parent
  }

  async readText(): Promise<string> {
    return this.content
  }

  write(text: string): void {
    this.content = text
  }
}

function normalizePath(path: string): string[] {
  return path.split('/').filter((part) => part !== '' && part !== '.')
}
