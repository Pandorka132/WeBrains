const binaryFileExtensions = new Set([
  '7z', 'avi', 'avif', 'bin', 'bmp', 'bz2', 'cab', 'class', 'db', 'dmg', 'dll', 'ear', 'eot', 'exe', 'flac', 'gif', 'gz', 'heic', 'icns', 'ico', 'iso', 'jar', 'jpeg', 'jpg', 'm4a', 'mov', 'mp3', 'mp4', 'ogg', 'otf', 'pdf', 'png', 'psd', 'rar', 'so', 'sqlite', 'tar', 'tif', 'tiff', 'ttf', 'wasm', 'wav', 'webm', 'webp', 'woff', 'woff2', 'war', 'xz', 'zip',
])

/** Heuristic guard for binary assets that must not be decoded and overwritten as UTF-8 text. */
export function isLikelyBinaryFileName(path: string): boolean {
  const name = path.split('/').at(-1)?.toLowerCase() ?? ''
  const extension = name.split('.').at(-1) ?? ''
  return binaryFileExtensions.has(extension)
}

export interface VirtualFile {
  readonly name: string
  readonly path: string
  readonly isDirectory: boolean
  readonly parent?: VirtualDirectory
  readText(): Promise<string>
  write?(text: string): void | Promise<void>
}

export interface VirtualDirectory extends VirtualFile {
  readonly isDirectory: true
  children(): readonly VirtualFile[]
  find(path: string): VirtualFile | undefined
}

export interface VirtualFileSystem {
  readonly root: VirtualDirectory
  find(path: string): VirtualFile | VirtualDirectory | undefined
  writeText(path: string, text: string): VirtualFile | Promise<VirtualFile>
  createDirectory(path: string): VirtualDirectory | Promise<VirtualDirectory>
  deleteEntry(path: string): void | Promise<void>
}

/** A small in-memory VFS. Host file access must be granted separately by the browser. */
export class MemoryFileSystem {
  readonly root: MemoryDirectory

  constructor(rootName = 'workspace') {
    if (!rootName || rootName === '.' || rootName === '..' || rootName.includes('/') || rootName.includes('\0')) {
      throw new Error('Virtual filesystem root name must be a valid single path segment')
    }
    this.root = new MemoryDirectory(rootName, `/${rootName}`)
  }

  createDirectory(path: string): MemoryDirectory {
    const segments = normalizePath(relativePathFrom(path, this.root.path))
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
    const segments = normalizePath(relativePathFrom(path, this.root.path))
    const name = segments.pop()
    if (!name) throw new Error('File path must name a file')
    const directory = this.createDirectory(segments.join('/'))
    return directory.addFile(name, text)
  }

  find(path: string): MemoryFile | MemoryDirectory | undefined {
    return this.root.find(path)
  }

  deleteEntry(path: string): void {
    const segments = normalizePath(relativePathFrom(path, this.root.path))
    const name = segments.pop()
    if (!name) throw new Error('The project root cannot be deleted from the project tree.')
    const parentPath = segments.length ? `${this.root.path}/${segments.join('/')}` : this.root.path
    const parent = this.find(parentPath)
    if (!(parent instanceof MemoryDirectory)) throw new Error('The parent directory could not be found.')
    if (!parent.remove(name)) throw new Error('The selected file or directory no longer exists.')
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

  remove(name: string): boolean {
    return this.entries.delete(name)
  }

  find(path: string): MemoryFile | MemoryDirectory | undefined {
    let segments: string[]
    try {
      segments = normalizePath(relativePathFrom(path, this.path))
    } catch {
      return undefined
    }
    return segments.reduce<MemoryFile | MemoryDirectory | undefined>(
      (current, segment) => current instanceof MemoryDirectory ? current.child(segment) : undefined,
      this,
    )
  }

  addDirectory(name: string): MemoryDirectory {
    this.assertValidName(name)
    if (this.entries.has(name)) throw new Error(`Entry already exists: ${name}`)
    const directory = new MemoryDirectory(name, `${this.path}/${name}`, this)
    this.entries.set(name, directory)
    return directory
  }

  addFile(name: string, text: string): MemoryFile {
    this.assertValidName(name)
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

  private assertValidName(name: string): void {
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) {
      throw new Error('Entry name must be a valid single path segment')
    }
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

/** Normalize a project-relative path and reject traversal beyond the virtual root. */
export function normalizeRelativePath(path: string): string[] {
  if (path.startsWith('/')) throw new RangeError('Expected a project-relative path')
  return normalizePath(path)
}

/** Convert a root-qualified path to a path relative to a directory without prefix collisions. */
export function relativePathFrom(path: string, basePath: string): string {
  if (path === basePath) return ''
  if (path.startsWith(`${basePath}/`)) return path.slice(basePath.length + 1)
  if (path.startsWith('/')) throw new RangeError(`Path is outside the virtual filesystem root: ${path}`)
  return path
}

function normalizePath(path: string): string[] {
  const segments: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (segments.length === 0) throw new RangeError('Path escapes the virtual filesystem root')
      segments.pop()
      continue
    }
    if (part.includes('\0')) throw new Error('Path segments cannot contain null characters')
    segments.push(part)
  }
  return segments
}
