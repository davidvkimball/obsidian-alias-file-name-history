import { App } from 'obsidian';
import { AliasFilenameHistorySettings } from '../settings';

export class AliasProcessor {
  constructor(
    private app: App,
    private settings: AliasFilenameHistorySettings
  ) {}

  async processAliases(path: string, queue: Set<string>): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return;

    const regexes: RegExp[] = [];
    for (const regexStr of this.settings.ignoreRegexes) {
      try {
        regexes.push(new RegExp(regexStr));
      } catch (e) {
        console.error(`Invalid ignore regex: ${regexStr}`, e);
      }
    }

    const toAdd: string[] = [];
    const currentBasename = file.basename;
    const currentBasenameLower = currentBasename.toLowerCase();

    for (const name of queue) {
      if (regexes.some(re => re.test(name))) {
        console.log(`Skipping alias "${name}" for file "${path}" due to matching ignore regex`);
        continue;
      }
      const nameLower = name.toLowerCase();
      if (
        (this.settings.caseSensitive && name === currentBasename) ||
        (!this.settings.caseSensitive && nameLower === currentBasenameLower)
      ) {
        console.log(`Skipping alias "${name}" for file "${path}": matches current basename`);
        continue;
      }
      toAdd.push(name);
    }

    if (toAdd.length === 0) return;

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      let aliases = fm.aliases;
      if (!Array.isArray(aliases)) {
        if (!this.settings.autoCreateFrontmatter) return;
        aliases = [];
        fm.aliases = aliases;
      }

      const existing = new Set<string>(
        this.settings.caseSensitive ? aliases : aliases.map((a: string) => a.toLowerCase())
      );

      for (const name of toAdd) {
        const checkName = this.settings.caseSensitive ? name : name.toLowerCase();
        if (!existing.has(checkName)) {
          aliases.push(name);
          existing.add(checkName);
          console.log(`Added alias "${name}" for file "${path}"`);
        }
      }
    });
  }
}
