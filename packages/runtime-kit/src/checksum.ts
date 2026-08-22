import { createHash, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'

const sha256Pattern = /^[a-f0-9]{64}$/

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

export async function verifyFileChecksum(
  filePath: string,
  expectedSha256: string,
): Promise<void> {
  if (!sha256Pattern.test(expectedSha256)) {
    throw new TypeError('expected checksum must be 64 lowercase hexadecimal characters')
  }
  const actualSha256 = await sha256File(filePath)
  if (
    !timingSafeEqual(Buffer.from(actualSha256, 'hex'), Buffer.from(expectedSha256, 'hex'))
  ) {
    throw new Error(
      `checksum mismatch for ${filePath}: expected ${expectedSha256}, received ${actualSha256}`,
    )
  }
}
