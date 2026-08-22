import { writeFile } from 'node:fs/promises'

export interface StoredZipEntry {
  readonly path: string
  readonly bytes: Buffer
  readonly externalAttributes?: number
}

export async function writeStoredZip(
  archivePath: string,
  entries: readonly StoredZipEntry[],
): Promise<void> {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let localOffset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8')
    const checksum = crc32(entry.bytes)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(entry.bytes.length, 18)
    local.writeUInt32LE(entry.bytes.length, 22)
    local.writeUInt16LE(name.length, 26)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x0314, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(entry.bytes.length, 20)
    central.writeUInt32LE(entry.bytes.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(entry.externalAttributes ?? ((0o100644 << 16) >>> 0), 38)
    central.writeUInt32LE(localOffset, 42)

    localParts.push(local, name, entry.bytes)
    centralParts.push(central, name)
    localOffset += local.length + name.length + entry.bytes.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(localOffset, 16)
  await writeFile(archivePath, Buffer.concat([...localParts, centralDirectory, end]))
}

const crcTable = createCrcTable()

function crc32(bytes: Buffer): number {
  let checksum = 0xffffffff
  for (const byte of bytes) {
    checksum = (checksum >>> 8) ^ (crcTable[(checksum ^ byte) & 0xff] ?? 0)
  }
  return (checksum ^ 0xffffffff) >>> 0
}

function createCrcTable(): readonly number[] {
  return Array.from({ length: 256 }, (_unused, index) => {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    return value >>> 0
  })
}
