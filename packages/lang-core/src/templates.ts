/** One text file of a project template (IO-01: text only, UTF-8, `\n` line endings). */
export interface TemplateFile {
  readonly path: string;
  readonly text: string;
}

/** What the new-project dialog shows for a template (LA-02, UX-60). */
export interface TemplateInfo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

/** A template with the files a new project starts with, sorted by path. */
export interface ProjectTemplate extends TemplateInfo {
  readonly files: readonly TemplateFile[];
}

/** A pack's templates: the blank one, then the others in display order. */
export interface TemplateSet {
  readonly blank: ProjectTemplate;
  readonly templates: readonly ProjectTemplate[];
}
