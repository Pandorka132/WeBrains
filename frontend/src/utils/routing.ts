export interface AppLocation {
  pathname: string
  search: string
}

/** Resolve clean routes locally and hash routes on static hosts with a repository subpath. */
export function resolveAppLocation(pathname: string, search: string, hash: string, base: string): AppLocation {
  if (base !== '/' && hash.startsWith('#/')) {
    const route = hash.slice(1)
    const queryIndex = route.indexOf('?')
    return {
      pathname: queryIndex < 0 ? route : route.slice(0, queryIndex),
      search: queryIndex < 0 ? '' : route.slice(queryIndex),
    }
  }

  const basePath = base === '/' ? '' : base.replace(/\/+$/, '')
  let resolvedPath = pathname
  if (basePath) {
    if (pathname === basePath || pathname === `${basePath}/`) resolvedPath = '/'
    else if (pathname.startsWith(`${basePath}/`)) resolvedPath = pathname.slice(basePath.length) || '/'
  }
  return { pathname: resolvedPath, search }
}

export function getAppLocation(): AppLocation {
  return resolveAppLocation(window.location.pathname, window.location.search, window.location.hash, import.meta.env.BASE_URL || '/')
}

/** Build an internal URL that works on both root-hosted sites and GitHub Pages subpaths. */
export function appUrl(path: string, search = '', base = import.meta.env.BASE_URL || '/'): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return base === '/' ? `${normalizedPath}${search}` : `${base}#${normalizedPath}${search}`
}

/** Navigate inside the existing React application without triggering a document load. */
export function navigateApp(path: string, search = ''): void {
  const target = appUrl(path, search)
  window.history.pushState(null, '', target)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
