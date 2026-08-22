import type { ResolvedRuntimeRelease } from './registry.ts'

export function validateOnlineRelease(release: ResolvedRuntimeRelease): void {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(release.version)) {
    throw new TypeError('online Harness release version is invalid')
  }
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(release.integrity)) {
    throw new TypeError('online Harness release integrity is invalid')
  }
  const tarball = new URL(release.tarballUrl)
  if (
    tarball.protocol !== 'https:' ||
    tarball.origin !== 'https://registry.npmjs.org' ||
    tarball.username.length > 0 ||
    tarball.password.length > 0 ||
    tarball.search.length > 0 ||
    tarball.hash.length > 0 ||
    tarball.pathname !== `/@deepseek-ai/dsh/-/dsh-${release.version}.tgz`
  ) {
    throw new TypeError('online Harness release tarball URL is untrusted')
  }
}
