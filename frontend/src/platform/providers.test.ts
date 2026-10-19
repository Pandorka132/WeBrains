import assert from 'node:assert/strict'
import { test } from 'node:test'
import { connectDrive, createDriveProject, isDriveConnected, listDriveProjects, openDriveProject, openLocalProject } from './providers.ts'

test('local project ids cannot escape the BrowserFS project root', async () => {
  await assert.rejects(openLocalProject('../../.webbrains-projects.json'), /Invalid local project id/)
  await assert.rejects(openLocalProject('/projects/other'), /Invalid local project id/)
})

test('Drive status stays safe when browser storage is blocked', () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem() { throw new Error('Storage blocked') },
      removeItem() { throw new Error('Storage blocked') },
      setItem() { throw new Error('Storage blocked') },
      clear() {},
      key() { return null },
      get length() { return 0 },
    } satisfies Storage,
  })
  try {
    assert.equal(isDriveConnected(), false)
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

class TestStorage implements Storage {
  private values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, String(value)) }
  entries(): [string, string][] { return [...this.values.entries()] }
}

test('Drive OAuth stores its token and expiry locally while project listing uses the Drive API', async () => {
  const storage = new TestStorage()
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalFetch = globalThis.fetch
  let requestToken: (() => void) | undefined
  let oauthCallback: ((response: { access_token?: string; expires_in?: number; error?: string }) => void) | undefined
  const driveRequests: { url: string; method: string; body: string }[] = []
  const driveFolders: { id: string; name: string; mimeType: string; parents?: string[]; modifiedTime?: string }[] = []
  let createdFolder = 0
  let uploadedFile = 0
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { google: { accounts: { oauth2: { initTokenClient: (options: { callback(response: { access_token?: string; expires_in?: number; error?: string }): void }) => {
      oauthCallback = options.callback
      return { requestAccessToken: () => requestToken?.() }
    } } } } },
  })
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? init.body : ''
    driveRequests.push({ url, method, body })
    assert.match(url, /^https:\/\/www\.googleapis\.com\/(?:drive\/v3|upload\/drive\/v3)\/files/)
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-token')
    let result: object = { files: [] }
    if (url.includes('/upload/drive/v3/files')) {
      const metadataText = body.split('\r\n\r\n')[1] ?? '{}'
      const metadata = JSON.parse(metadataText.split('\r\n--')[0] ?? '{}') as { name?: string; parents?: string[] }
      result = { id: `uploaded-${++uploadedFile}`, name: metadata.name ?? (body.includes('README.md') ? 'README.md' : 'App.tsx'), mimeType: 'text/plain' }
    } else if (method === 'POST') {
      const metadata = JSON.parse(body) as { name: string; mimeType: string; parents?: string[] }
      const folder = { id: `folder-${++createdFolder}`, name: metadata.name, mimeType: metadata.mimeType, parents: metadata.parents, modifiedTime: new Date().toISOString() }
      driveFolders.push(folder)
      result = folder
    } else if (new URL(url).pathname.startsWith('/drive/v3/files/') && new URL(url).pathname.split('/').filter(Boolean).length === 4) {
      const id = new URL(url).pathname.split('/').at(-1)
      result = driveFolders.find((folder) => folder.id === id) ?? { id, name: 'Unknown', mimeType: 'text/plain' }
    } else if (url.includes('/files?fields=id,name')) {
      result = { id: 'project-folder', name: 'Drive Test', mimeType: 'application/vnd.google-apps.folder' }
    } else {
      const query = decodeURIComponent(new URL(url).searchParams.get('q') ?? '')
      const parentMatch = query.match(/'([^']+)' in parents/)
      const parentId = parentMatch?.[1]
      const nameMatch = query.match(/name='([^']+)'/)
      const exactName = nameMatch?.[1]
      const matches = driveFolders.filter((folder) => {
        const parentMatches = parentId === 'root' ? !folder.parents?.length : parentId ? folder.parents?.includes(parentId) : true
        return parentMatches && (!exactName || folder.name === exactName) && folder.mimeType === 'application/vnd.google-apps.folder'
      })
      result = parentId === 'duplicate-project'
        ? { files: [
            { id: 'duplicate-file-1', name: 'main.py', mimeType: 'text/plain' },
            { id: 'duplicate-file-2', name: 'main.py', mimeType: 'text/plain' },
          ] }
        : { files: matches }
    }
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  requestToken = () => oauthCallback?.({ access_token: 'test-token', expires_in: 3600 })

  try {
    await connectDrive('web-client-id.apps.googleusercontent.com')
    assert.equal(isDriveConnected(), true)
    assert.deepEqual(await listDriveProjects(), [])
    assert.equal(driveFolders.length, 0, 'listing an empty Drive must not create folders')
    const workspace = await createDriveProject('Drive Test')
    assert.equal(workspace.provider, 'drive')
    const projectFolder = driveFolders.find((folder) => folder.name === 'Drive Test')
    assert.ok(projectFolder)
    const createdDirectory = await workspace.files.createDirectory('src/components')
    assert.equal(createdDirectory.name, 'components')
    const srcFolder = driveFolders.find((folder) => folder.name === 'src' && folder.parents?.includes(projectFolder?.id ?? ''))
    assert.ok(srcFolder, 'creating a nested directory should create its missing parent')
    assert.ok(driveFolders.some((folder) => folder.name === 'components' && folder.parents?.includes(srcFolder.id)))
    assert.ok(driveRequests.some((request) => request.url.includes('/upload/drive/v3/files') && request.body.includes('# Drive Test')))
    assert.ok(driveRequests.some((request) => request.url.includes('/upload/drive/v3/files') && request.body.includes('def main()')))
    const webBrainsFolder = driveFolders.find((folder) => folder.name === 'WebBrains')
    const projectsFolder = driveFolders.find((folder) => folder.name === 'projects' && folder.parents?.includes(webBrainsFolder?.id ?? ''))
    assert.ok(webBrainsFolder)
    assert.ok(projectsFolder)
    assert.ok(projectFolder?.parents?.includes(projectsFolder.id))
    assert.ok(driveRequests.some((request) => request.url.includes('q=') && decodeURIComponent(request.url).includes("'root' in parents and name='WebBrains'")))
    assert.ok(driveRequests.some((request) => request.url.includes('q=') && decodeURIComponent(request.url).includes(`'${webBrainsFolder.id}' in parents and name='projects'`)))
    driveFolders.push({ id: 'duplicate-project', name: 'Duplicate project', mimeType: 'application/vnd.google-apps.folder' })
    await assert.rejects(openDriveProject('duplicate-project'), /contains duplicate names \(main\.py\)/)
    const storedValues = storage.entries()
    assert.equal(storedValues.length, 1)
    assert.ok(storedValues.some(([key, value]) => key.includes('oauth') && value.includes('test-token')))
    assert.ok(storedValues.every(([, value]) => !value.includes('README') && !value.includes('project files')))
    storage.setItem('webbrains.drive.oauth', JSON.stringify({ accessToken: 'expired-token', expiresAt: Date.now() - 1000 }))
    assert.equal(isDriveConnected(), false)
    storage.setItem('webbrains.drive.oauth', JSON.stringify({ accessToken: 'malformed-token' }))
    assert.equal(isDriveConnected(), false)
    assert.equal(storage.getItem('webbrains.drive.oauth'), null)
  } finally {
    globalThis.fetch = originalFetch
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
