export type PythonSyntaxError = {
  readonly message: string
  readonly line: number
  readonly column: number
  readonly endLine: number
  readonly endColumn: number
}

export type PythonSyntaxDiagnosticRange = {
  readonly startOffset: number
  readonly endOffset: number
  readonly message: string
}

/** Converts Python's 1-based SyntaxError line/column coordinates to editor UTF-16 offsets. */
export function mapPythonSyntaxError(source: string, issue: PythonSyntaxError): PythonSyntaxDiagnosticRange | null {
  if (source.length === 0) return null
  const lines = source.split(String.fromCharCode(10))
  const offsetAt = (lineNumber: number, columnNumber: number) => {
    let offset = 0
    for (let index = 0; index < Math.max(0, lineNumber - 1) && index < lines.length; index += 1) {
      offset += lines[index].length + 1
    }
    return Math.min(source.length, offset + Math.max(0, columnNumber - 1))
  }
  let startOffset = offsetAt(issue.line, issue.column)
  let endOffset = offsetAt(issue.endLine, issue.endColumn)
  if (startOffset >= source.length) startOffset = source.length - 1
  if (endOffset <= startOffset) endOffset = Math.min(source.length, startOffset + 1)
  return endOffset > startOffset ? { startOffset, endOffset, message: issue.message } : null
}
