// POSIX path helpers for include resolution. They mirror `java.nio.file.Path.resolve(..).normalize()` as nf-lang uses it
// in nextflow/script/control/ModuleResolver.java (`getLocalIncludeUri`) and nextflow/config/control/ResolveIncludeVisitor.java
// (`getIncludeUri`), nextflow v26.10.7 (Apache-2.0; see ../../grammar/NOTICE).

/** Remove `.`, `//` and a trailing `/`, and fold `..`. A relative path keeps `..` above its root; an absolute one drops it. */
function normalise(path: string): string {
  const absolute = path.startsWith("/");
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      const last = out[out.length - 1];
      if (last !== undefined && last !== "..") out.pop();
      else if (!absolute) out.push("..");
      continue;
    }
    out.push(part);
  }
  const joined = out.join("/");
  return absolute ? `/${joined}` : joined;
}

/** The directory of a file path; "" for a file at the project root. */
export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  if (i < 0) return "";
  return i === 0 ? "/" : path.slice(0, i);
}

/** `source` resolved against `dir` and normalised; an absolute `source` ignores `dir`. */
export function resolvePath(dir: string, source: string): string {
  return normalise(
    source.startsWith("/") || dir === "" ? source : `${dir}/${source}`,
  );
}

export function joinPath(...parts: string[]): string {
  return normalise(parts.filter((p) => p !== "").join("/"));
}
