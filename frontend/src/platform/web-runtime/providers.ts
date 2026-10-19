import { isLikelyBinaryFileName, normalizeRelativePath, relativePathFrom } from '../core/vfs.ts'
import type { VirtualDirectory, VirtualFile, VirtualFileSystem } from '../core/vfs.ts'

type ProviderKind = 'local' | 'drive'
export interface ProjectSummary { id: string; name: string; updatedAt: number; provider: ProviderKind }
export interface ProjectWorkspace { id: string; name: string; provider: ProviderKind; files: VirtualFileSystem }

type BrowserFsApi = {
  readdirSync(path: string): string[]
  statSync(path: string): { isDirectory(): boolean }
  readFileSync(path: string, encoding: string): string
  writeFileSync(path: string, text: string, encoding?: string): void
  mkdirSync(path: string, options?: { recursive?: boolean }): void
  existsSync(path: string): boolean
  unlinkSync(path: string): void
  rmdirSync(path: string): void
}
declare global { interface Window { google?: GoogleGlobal } }

type GoogleGlobal = { accounts?: { oauth2: { initTokenClient(options: { client_id: string; scope: string; callback(response: { access_token?: string; expires_in?: number; error?: string }): void }): { requestAccessToken(): void } } } }
const tokenKey = 'webbrains.drive.oauth'
const localMetaPath = '/.webbrains-projects.json'
let browserFsPromise: Promise<BrowserFsApi> | undefined

// randomUUID is missing in older browsers and on non-secure origins such as HTTP LAN hostnames.
function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

function browserFs(): Promise<BrowserFsApi> {
  if (browserFsPromise) return browserFsPromise
  browserFsPromise = import('browserfs').then((BrowserFS) => new Promise((resolve, reject) => {
    // AsyncMirror exposes synchronous operations to the IDE while persisting every write
    // to BrowserFS's IndexedDB backend. The in-memory mirror is not the durable store.
    BrowserFS.configure({ fs: 'AsyncMirror', options: { sync: { fs: 'InMemory' }, async: { fs: 'IndexedDB', options: { storeName: 'webbrains-projects' } } } }, (error) => {
      if (error) { browserFsPromise = undefined; reject(error); return }
      resolve(BrowserFS.BFSRequire('fs') as unknown as BrowserFsApi)
    })
  }))
  return browserFsPromise
}

type LocalMetadata = { id: string; name: string; updatedAt: number }
async function readLocalMetadata(fs: BrowserFsApi): Promise<LocalMetadata[]> {
  if (!fs.existsSync(localMetaPath)) return []
  try {
    const value: unknown = JSON.parse(fs.readFileSync(localMetaPath, 'utf8'))
    if (!Array.isArray(value)) return []
    const byId = new Map<string, LocalMetadata>()
    for (const entry of value.filter(isLocalMetadata)) {
      const project = { ...entry, name: entry.name.trim() }
      const existing = byId.get(project.id)
      if (!existing || project.updatedAt >= existing.updatedAt) byId.set(project.id, project)
    }
    return [...byId.values()]
  } catch {
    return []
  }
}

function isLocalMetadata(value: unknown): value is LocalMetadata {
  if (typeof value !== 'object' || value === null) return false
  const project = value as Partial<LocalMetadata>
  return typeof project.id === 'string' && isSafeLocalProjectId(project.id) && typeof project.name === 'string' && project.name.trim().length > 0 && typeof project.updatedAt === 'number' && Number.isFinite(project.updatedAt)
}
function saveLocalMetadata(fs: BrowserFsApi, projects: LocalMetadata[]): void { fs.writeFileSync(localMetaPath, JSON.stringify(projects), 'utf8') }

function isSafeLocalProjectId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(id) && id !== '.' && id !== '..'
}

class BrowserDirectory implements VirtualDirectory {
  readonly isDirectory = true as const
  readonly name: string
  readonly path: string
  private fs: BrowserFsApi
  constructor(fs: BrowserFsApi, path: string, name: string) { this.fs = fs; this.path = path; this.name = name }
  async readText(): Promise<string> { throw new Error('Cannot read text from a directory') }
  children(): readonly VirtualFile[] {
    return this.fs.readdirSync(this.path).map((name) => {
      const path = `${this.path}/${name}`
      return this.fs.statSync(path).isDirectory() ? new BrowserDirectory(this.fs, path, name) : new BrowserFile(this.fs, path, name)
    })
  }
  find(path: string): VirtualFile | VirtualDirectory | undefined {
    let segments: string[]
    try {
      segments = normalizeRelativePath(relativePathFrom(path, this.path))
    } catch {
      return undefined
    }
    const target = segments.length ? `${this.path}/${segments.join('/')}` : this.path
    if (!this.fs.existsSync(target)) return undefined
    const name = target.split('/').at(-1) ?? this.name
    return this.fs.statSync(target).isDirectory() ? new BrowserDirectory(this.fs, target, name) : new BrowserFile(this.fs, target, name)
  }
}
class BrowserFile implements VirtualFile {
  readonly isDirectory = false as const
  readonly path: string
  readonly name: string
  private fs: BrowserFsApi
  constructor(fs: BrowserFsApi, path: string, name: string) { this.fs = fs; this.path = path; this.name = name }
  async readText(): Promise<string> {
    if (isLikelyBinaryFileName(this.name)) throw new Error(`Binary file "${this.name}" cannot be edited as text in WebBrains yet.`)
    return this.fs.readFileSync(this.path, 'utf8')
  }
  write(text: string): void {
    if (isLikelyBinaryFileName(this.name)) throw new Error(`Binary file "${this.name}" cannot be edited as text in WebBrains yet.`)
    this.fs.writeFileSync(this.path, text, 'utf8')
  }
}

class BrowserFileSystem implements VirtualFileSystem {
  readonly root: VirtualDirectory
  private fs: BrowserFsApi
  private basePath: string
  constructor(fs: BrowserFsApi, basePath: string) { this.fs = fs; this.basePath = basePath; this.root = new BrowserDirectory(fs, basePath, basePath.split('/').at(-1) ?? 'project') }
  find(path: string): VirtualFile | VirtualDirectory | undefined { return this.root.find(path) }
  createDirectory(path: string): VirtualDirectory {
    const parts = normalizeRelativePath(relativePathFrom(path, this.basePath))
    const target = `${this.basePath}/${parts.join('/')}`
    ensureBrowserDirectory(this.fs, target)
    return new BrowserDirectory(this.fs, target, parts.at(-1) ?? this.root.name)
  }
  deleteEntry(path: string): void {
    const parts = normalizeRelativePath(relativePathFrom(path, this.basePath))
    if (!parts.length) throw new Error('The project root cannot be deleted from the project tree.')
    removeBrowserPath(this.fs, `${this.basePath}/${parts.join('/')}`)
  }
  writeText(path: string, text: string): VirtualFile {
    const relative = normalizeRelativePath(relativePathFrom(path, this.basePath)).join('/')
    if (!relative) throw new Error('File path must name a file')
    if (isLikelyBinaryFileName(relative)) throw new Error(`Binary file "${relative}" cannot be edited as text in WebBrains yet.`)
    const absolute = `${this.basePath}/${relative}`
    const parts = absolute.split('/'); parts.pop()
    const parent = parts.join('/')
    ensureBrowserDirectory(this.fs, parent)
    this.fs.writeFileSync(absolute, text, 'utf8')
    return new BrowserFile(this.fs, absolute, absolute.split('/').at(-1)!)
  }
}

export async function listLocalProjects(): Promise<ProjectSummary[]> {
  const fs = await browserFs()
  return (await readLocalMetadata(fs)).sort((a, b) => b.updatedAt - a.updatedAt).map((project) => ({ ...project, provider: 'local' }))
}

export async function createLocalProject(name: string, initialFiles: Readonly<Record<string, string>> = {}): Promise<ProjectWorkspace> {
  const fs = await browserFs()
  const cleanName = name.trim()
  if (!cleanName) throw new Error('Enter a project name.')
  const metadata = await readLocalMetadata(fs)
  const id = `${slug(cleanName)}-${createId().replace(/-/g, '').slice(0, 8)}`
  const base = `/projects/${id}`
  // BrowserFS's recursive mkdir option is not consistently supported by all backends.
  // Create each path segment explicitly so a fresh IndexedDB filesystem has /projects.
  ensureBrowserDirectory(fs, '/projects')
  ensureBrowserDirectory(fs, base)
  const files = new BrowserFileSystem(fs, base)
  for (const [path, content] of Object.entries(initialFiles)) files.writeText(path, content)
  metadata.push({ id, name: cleanName, updatedAt: Date.now() })
  saveLocalMetadata(fs, metadata)
  return { id, name: cleanName, provider: 'local', files }
}

export async function deleteLocalProject(id: string): Promise<void> {
  if (!isSafeLocalProjectId(id)) throw new Error('Invalid local project id.')
  const fs = await browserFs()
  const metadata = await readLocalMetadata(fs)
  const project = metadata.find((entry) => entry.id === id)
  if (!project) throw new Error('That local project could not be found.')
  const basePath = `/projects/${id}`
  if (fs.existsSync(basePath)) removeBrowserPath(fs, basePath)
  saveLocalMetadata(fs, metadata.filter((entry) => entry.id !== id))
}

function removeBrowserPath(fs: BrowserFsApi, path: string): void {
  if (!fs.existsSync(path)) return
  if (fs.statSync(path).isDirectory()) {
    for (const name of fs.readdirSync(path)) removeBrowserPath(fs, `${path}/${name}`)
    fs.rmdirSync(path)
  } else {
    fs.unlinkSync(path)
  }
}

export async function openLocalProject(id: string): Promise<ProjectWorkspace> {
  if (!isSafeLocalProjectId(id)) throw new Error('Invalid local project id.')
  const fs = await browserFs()
  const metadata = (await readLocalMetadata(fs)).find((project) => project.id === id)
  if (!metadata) throw new Error('That local project could not be found.')
  const basePath = `/projects/${id}`
  if (!fs.existsSync(basePath) || !fs.statSync(basePath).isDirectory()) {
    throw new Error('The files for this local project are missing or unavailable.')
  }
  return { ...metadata, provider: 'local', files: new BrowserFileSystem(fs, basePath) }
}

function ensureBrowserDirectory(fs: BrowserFsApi, path: string): void {
  let current = ''
  for (const segment of path.split('/').filter(Boolean)) {
    current += `/${segment}`
    if (!fs.existsSync(current)) fs.mkdirSync(current)
    else if (!fs.statSync(current).isDirectory()) throw new Error(`Cannot create project directory because ${current} is a file.`)
  }
}

function slug(value: string): string { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project' }

export function getConfiguredGoogleClientId(): string { return import.meta.env?.VITE_GOOGLE_CLIENT_ID?.trim() ?? '' }
export function isDriveConnected(): boolean {
  const token = readToken()
  if (!token || token.expiresAt <= Date.now() + 30_000) {
    if (token) removeStoredToken()
    return false
  }
  return true
}
function removeStoredToken(): void {
  try { localStorage.removeItem(tokenKey) } catch { /* Storage may be unavailable in restricted browser contexts. */ }
}

function readToken(): { accessToken: string; expiresAt: number } | undefined {
  try {
    const raw = localStorage.getItem(tokenKey)
    if (!raw) return undefined
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) throw new Error('Invalid stored Drive token')
    const token = value as { accessToken?: unknown; expiresAt?: unknown }
    if (typeof token.accessToken !== 'string' || token.accessToken.length === 0 || typeof token.expiresAt !== 'number' || !Number.isFinite(token.expiresAt)) {
      throw new Error('Invalid stored Drive token')
    }
    return { accessToken: token.accessToken, expiresAt: token.expiresAt }
  } catch {
    removeStoredToken()
    return undefined
  }
}

async function ensureGoogleIdentity(): Promise<NonNullable<GoogleGlobal['accounts']>['oauth2']> {
  if (window.google?.accounts?.oauth2) return window.google.accounts.oauth2
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src^="https://accounts.google.com/gsi/client"]')
    const script = existing && existing.dataset.webbrainsFailed !== 'true' ? existing : document.createElement('script')
    const timeout = window.setTimeout(() => {
      script.dataset.webbrainsLoading = 'false'
      script.dataset.webbrainsFailed = 'true'
      script.remove()
      reject(new Error('Google Identity Services timed out while loading. Check your connection and try again.'))
    }, 10_000)
    script.addEventListener('load', () => {
      window.clearTimeout(timeout)
      script.dataset.webbrainsLoading = 'false'
      script.dataset.webbrainsLoaded = 'true'
      if (window.google?.accounts?.oauth2) resolve()
      else reject(new Error('Google Identity Services loaded but did not initialize. Reload the page and try again.'))
    }, { once: true })
    script.addEventListener('error', () => {
      window.clearTimeout(timeout)
      script.dataset.webbrainsLoading = 'false'
      script.dataset.webbrainsFailed = 'true'
      script.remove()
      reject(new Error('Google Identity Services could not be loaded. Check your connection.'))
    }, { once: true })
    if (script !== existing) {
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.dataset.webbrainsLoading = 'true'
      document.head.append(script)
    } else if (script.dataset.webbrainsLoaded === 'true' && !window.google?.accounts?.oauth2) {
      window.clearTimeout(timeout)
      script.dataset.webbrainsFailed = 'true'
      script.remove()
      reject(new Error('Google Identity Services did not initialize. Reload the page and try again.'))
    }
  })
  const oauth = window.google?.accounts?.oauth2
  if (!oauth) throw new Error('Google Identity Services did not initialize. Reload the page and try again.')
  return oauth
}

export async function connectDrive(clientId = getConfiguredGoogleClientId()): Promise<void> {
  if (!clientId) throw new Error('Google sign-in is not configured for this WebBrains deployment yet.')
  const google = await ensureGoogleIdentity()
  await new Promise<void>((resolve, reject) => {
    const client = google.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (response) => {
        if (!response.access_token) { reject(new Error(response.error ?? 'Google authorization was not granted.')); return }
        try {
          localStorage.setItem(tokenKey, JSON.stringify({ accessToken: response.access_token, expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000 }))
          resolve()
        } catch {
          reject(new Error('Browser storage is unavailable, so the Google Drive session could not be saved.'))
        }
      },
    })
    client.requestAccessToken()
  })
}

function driveToken(): string {
  const token = readToken()
  if (!token || token.expiresAt <= Date.now()) {
    if (token) removeStoredToken()
    throw new Error('Your Google Drive session expired. Reconnect to continue.')
  }
  return token.accessToken
}
async function driveRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://www.googleapis.com/drive/v3${path}`, { ...init, headers: { Authorization: `Bearer ${driveToken()}`, ...init.headers } })
  if (!response.ok) {
    if (response.status === 401) removeStoredToken()
    const detail = await response.text()
    throw new Error(`Google Drive request failed (${response.status}): ${detail.slice(0, 180)}`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
type DriveRecord = { id: string; name: string; mimeType: string; modifiedTime?: string; parents?: string[] }
const folderMime = 'application/vnd.google-apps.folder'
async function findDriveFolder(name: string, parentId?: string): Promise<DriveRecord | undefined> {
  const parentClause = parentId ? `'${parentId}' in parents and ` : `'root' in parents and `
  const query = encodeURIComponent(`${parentClause}name='${name}' and mimeType='${folderMime}' and trashed=false`)
  const result = await driveRequest<{ files: DriveRecord[] }>(`/files?fields=files(id,name,mimeType,parents)&pageSize=100&q=${query}`)
  return result.files.find((folder) => folder.name === name && folder.mimeType === folderMime)
}
async function ensureDriveFolder(name: string, parentId?: string): Promise<DriveRecord> {
  const existing = await findDriveFolder(name, parentId)
  if (existing) return existing
  const metadata: { name: string; mimeType: string; parents?: string[] } = { name, mimeType: folderMime }
  if (parentId) metadata.parents = [parentId]
  return driveRequest<DriveRecord>('/files?fields=id,name,mimeType,parents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metadata) })
}
async function driveProjectsFolder(): Promise<DriveRecord> {
  const root = await ensureDriveFolder('WebBrains')
  return ensureDriveFolder('projects', root.id)
}
export async function listDriveProjects(): Promise<ProjectSummary[]> {
  const webBrainsFolder = await findDriveFolder('WebBrains')
  if (!webBrainsFolder) return []
  const projectsFolder = await findDriveFolder('projects', webBrainsFolder.id)
  if (!projectsFolder) return []
  const projects: ProjectSummary[] = []
  let pageToken = ''
  do {
    const query = encodeURIComponent(`'${projectsFolder.id}' in parents and mimeType='${folderMime}' and trashed=false`)
    const result = await driveRequest<{ files: DriveRecord[]; nextPageToken?: string }>(`/files?fields=nextPageToken,files(id,name,modifiedTime,parents)&pageSize=100&q=${query}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`)
    projects.push(...result.files.map((file) => ({ id: file.id, name: file.name, updatedAt: Date.parse(file.modifiedTime ?? '') || 0, provider: 'drive' as const })))
    pageToken = result.nextPageToken ?? ''
  } while (pageToken)
  return projects.sort((a, b) => b.updatedAt - a.updatedAt)
}
export async function deleteDriveProject(id: string): Promise<void> {
  if (!id.trim()) throw new Error('A Google Drive project id is required.')
  await driveRequest<void>(`/files/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) })
}

export async function createDriveProject(name: string, initialFiles: Readonly<Record<string, string>> = {}): Promise<ProjectWorkspace> {
  const cleanName = name.trim()
  if (!cleanName) throw new Error('Enter a project name.')
  const projectsFolder = await driveProjectsFolder()
  const folder = await driveRequest<DriveRecord>('/files?fields=id,name,mimeType,parents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: cleanName, mimeType: folderMime, parents: [projectsFolder.id], appProperties: { webbrainsProject: 'true' } }) })
  const workspace = await openDriveProject(folder.id)
  for (const [path, content] of Object.entries(initialFiles)) await workspace.files.writeText(path, content)
  return workspace
}

type DriveEntry = { id: string; name: string; isDirectory: boolean; parent?: DriveDirectory }
class DriveDirectory implements VirtualDirectory {
  readonly isDirectory = true as const
  readonly path: string
  readonly name: string
  entries: Map<string, DriveEntry>
  readonly id: string
  readonly parent?: DriveDirectory
  constructor(id: string, name: string, path: string, parent?: DriveDirectory, entries = new Map<string, DriveEntry>()) { this.id = id; this.name = name; this.path = path; this.parent = parent; this.entries = entries }
  async readText(): Promise<string> { throw new Error('Cannot read text from a directory') }
  children(): readonly VirtualFile[] { return [...this.entries.values()].map((entry) => entry.isDirectory ? new DriveDirectoryView(entry as DriveEntry & { parent?: DriveDirectory }, this) : new DriveFile(entry.id, entry.name, `${this.path}/${entry.name}`)) }
  find(path: string): VirtualFile | VirtualDirectory | undefined {
    let parts: string[]
    try {
      parts = normalizeRelativePath(relativePathFrom(path, this.path))
    } catch {
      return undefined
    }
    const resolve = (directory: DriveDirectory, index: number): VirtualFile | VirtualDirectory | undefined => {
      if (index >= parts.length) return directory
      const entry = directory.entries.get(parts[index])
      if (!entry) return undefined
      if (index === parts.length - 1) return entry.isDirectory ? entry as DriveDirectory : new DriveFile(entry.id, entry.name, `${directory.path}/${entry.name}`)
      return entry.isDirectory ? resolve(entry as DriveDirectory, index + 1) : undefined
    }
    return resolve(this, 0)
  }
}
class DriveDirectoryView extends DriveDirectory {
  constructor(entry: DriveEntry & { parent?: DriveDirectory }, parent: DriveDirectory) { super(entry.id, entry.name, `${parent.path}/${entry.name}`, parent, (entry as DriveDirectory).entries) }
}
class DriveFile implements VirtualFile {
  readonly isDirectory = false as const
  readonly id: string
  readonly name: string
  readonly path: string
  constructor(id: string, name: string, path: string) { this.id = id; this.name = name; this.path = path }
  async readText(): Promise<string> {
    if (isLikelyBinaryFileName(this.name)) throw new Error(`Binary file "${this.name}" cannot be edited as text in WebBrains yet.`)
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(this.id)}?alt=media`, { headers: { Authorization: `Bearer ${driveToken()}` } })
    if (!response.ok) {
      if (response.status === 401) removeStoredToken()
      throw new Error(`Could not read ${this.name} from Google Drive (${response.status}).`)
    }
    return response.text()
  }
  async write(text: string): Promise<void> {
    if (isLikelyBinaryFileName(this.name)) throw new Error(`Binary file "${this.name}" cannot be edited as text in WebBrains yet.`)
    await uploadDriveFile(this.id, text)
  }
}
async function uploadDriveFile(id: string | undefined, text: string, parentId?: string, name?: string): Promise<DriveRecord> {
  const boundary = `webbrains-${createId()}`
  const metadata = id ? {} : { name, parents: parentId ? [parentId] : [] }
  const body = `--${boundary}\r
Content-Type: application/json; charset=UTF-8\r
\r
${JSON.stringify(metadata)}\r
--${boundary}\r
Content-Type: text/plain; charset=UTF-8\r
\r
${text}\r
--${boundary}--`
  const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files${id ? `/${encodeURIComponent(id)}` : ''}?uploadType=multipart&fields=id,name,mimeType`, { method: id ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${driveToken()}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body })
  if (!response.ok) {
    if (response.status === 401) removeStoredToken()
    throw new Error(`Could not save to Google Drive (${response.status}).`)
  }
  return response.json() as Promise<DriveRecord>
}
class DriveFileSystem implements VirtualFileSystem {
  readonly root: DriveDirectory
  constructor(root: DriveDirectory) { this.root = root }
  find(path: string): VirtualFile | VirtualDirectory | undefined { return this.root.find(path) }
  async createDirectory(path: string): Promise<VirtualDirectory> {
    const parts = normalizeRelativePath(relativePathFrom(path, this.root.path))
    if (!parts.length) return this.root
    let directory = this.root
    for (const segment of parts) {
      let entry = directory.entries.get(segment)
      if (!entry) {
        const result = await driveRequest<DriveRecord>('/files?fields=id,name,mimeType', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: segment, mimeType: folderMime, parents: [directory.id] }) })
        const created = new DriveDirectory(result.id, segment, `${directory.path}/${segment}`, directory)
        directory.entries.set(segment, created)
        entry = created
      }
      if (!entry.isDirectory) throw new Error(`${segment} is a file`)
      directory = entry as DriveDirectory
    }
    return directory
  }
  async deleteEntry(path: string): Promise<void> {
    const parts = normalizeRelativePath(relativePathFrom(path, this.root.path))
    const name = parts.pop()
    if (!name) throw new Error('The project root cannot be deleted from the project tree.')
    let parent = this.root
    for (const segment of parts) {
      const entry = parent.entries.get(segment)
      if (!entry?.isDirectory) throw new Error('The parent directory could not be found.')
      parent = entry as DriveDirectory
    }
    const entry = parent.entries.get(name)
    if (!entry) throw new Error('The selected file or directory no longer exists.')
    await driveRequest<void>(`/files/${encodeURIComponent(entry.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) })
    parent.entries.delete(name)
  }
  async writeText(path: string, text: string): Promise<VirtualFile> {
    const parts = normalizeRelativePath(relativePathFrom(path, this.root.path))
    const filename = parts.pop()
    if (!filename) throw new Error('File path must name a file')
    if (isLikelyBinaryFileName(filename)) throw new Error(`Binary file "${filename}" cannot be edited as text in WebBrains yet.`)
    let directory = this.root
    for (const segment of parts) {
      let entry = directory.entries.get(segment)
      if (!entry) {
        const result = await driveRequest<DriveRecord>('/files?fields=id,name,mimeType', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: segment, mimeType: folderMime, parents: [directory.id] }) })
        const created = new DriveDirectory(result.id, segment, `${directory.path}/${segment}`, directory)
        directory.entries.set(segment, created); entry = created
      }
      if (!entry.isDirectory) throw new Error(`${segment} is a file`)
      directory = entry as DriveDirectory
    }
    const existing = directory.entries.get(filename)
    const result = await uploadDriveFile(existing?.id, text, directory.id, filename)
    const file = new DriveFile(result.id, filename, `${directory.path}/${filename}`)
    directory.entries.set(filename, { id: file.id, name: filename, isDirectory: false })
    return file
  }
}
async function loadDriveDirectory(id: string, name: string, path: string, parent?: DriveDirectory): Promise<DriveDirectory> {
  const directory = new DriveDirectory(id, name, path, parent)
  const query = encodeURIComponent(`'${id}' in parents and trashed=false`)
  let pageToken = ''
  do {
    const result = await driveRequest<{ files: DriveRecord[]; nextPageToken?: string }>(`/files?fields=nextPageToken,files(id,name,mimeType)&pageSize=100&q=${query}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`)
    for (const item of result.files) {
      if (directory.entries.has(item.name)) {
        throw new Error(`Google Drive folder "${path}" contains duplicate names (${item.name}). Rename one of them before opening this project in WebBrains.`)
      }
      const child = item.mimeType === folderMime ? await loadDriveDirectory(item.id, item.name, `${path}/${item.name}`, directory) : { id: item.id, name: item.name, isDirectory: false }
      directory.entries.set(item.name, child)
    }
    pageToken = result.nextPageToken ?? ''
  } while (pageToken)
  return directory
}
export async function openDriveProject(id: string): Promise<ProjectWorkspace> {
  if (!id.trim()) throw new Error('A Google Drive project id is required.')
  const info = await driveRequest<DriveRecord>(`/files/${encodeURIComponent(id)}?fields=id,name,mimeType`)
  if (info.mimeType !== folderMime) throw new Error('The selected Google Drive project is not a folder.')
  const root = await loadDriveDirectory(id, info.name, `/${info.name}`)
  return { id, name: info.name, provider: 'drive', files: new DriveFileSystem(root) }
}

export async function openWorkspace(provider: ProviderKind, id: string): Promise<ProjectWorkspace> {
  return provider === 'drive' ? openDriveProject(id) : openLocalProject(id)
}
