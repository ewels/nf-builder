export const FIXTURE_URI = "file:///spike/main.nf";
// tools/oracle/cases/<id>/main.nf: read by path, never imported.
export const FIXTURE_CASE = "s3-known-error-500";
/** 1-based. */
export const KNOWN_ERROR_LINE = 487;

export function editName(index: number): string {
  return index === 0 ? "undefined_channel" : `undefined_channel_${index}`;
}

export function expectedMessage(name: string): string {
  return `\`${name}\` is not defined`;
}

export function withUndefinedVariable(text: string, name: string): string {
  const lines = text.split("\n");
  const line = lines[KNOWN_ERROR_LINE - 1];
  if (
    line === undefined ||
    !/^ {4}undefined_channel(_\d+)?\.view\(\)$/.test(line)
  )
    throw new Error(
      `fixture line ${KNOWN_ERROR_LINE} is not an undefined_channel call: ${line ?? "(missing)"}`,
    );
  lines[KNOWN_ERROR_LINE - 1] = `    ${name}.view()`;
  return lines.join("\n");
}
