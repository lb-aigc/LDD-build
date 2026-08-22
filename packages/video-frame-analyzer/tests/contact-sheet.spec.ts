import { describe, expect, it } from 'vitest'

import { buildContactSheetCommand } from '../src/contact-sheet.ts'

describe('contact-sheet command', () => {
  it('keeps a hostile filename in argv and never invokes a shell', () => {
    const input = 'clip"; del C:\\data #.mp4'
    const argv = buildContactSheetCommand(input, [0], 'sheet.jpg')
    expect(argv.filter((value) => value === input)).toHaveLength(1)
    expect(argv).not.toContain('cmd.exe')
    expect(argv).not.toContain('powershell.exe')
  })
})
