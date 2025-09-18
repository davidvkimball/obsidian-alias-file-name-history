import { App, Plugin, PluginSettingTab, Setting, TFile, TAbstractFile } from 'obsidian';

interface AliasFilenameHistorySettings {
  ignoreRegexes: string[];
  timeoutSeconds: number;
  caseSensitive: boolean;
  autoCreateFrontmatter: boolean;
  includeFolders: string[];
  excludeFolders: string[];
  fileExtensions: string[];
  trackFolderRenames: boolean;
}

const DEFAULT_SETTINGS: AliasFilenameHistorySettings = {
  ignoreRegexes: ['^_', '^Untitled$', '^Untitled \\d+$'],
  timeoutSeconds: 5,
  caseSensitive: false,
  autoCreateFrontmatter: true,
  includeFolders: [],
  excludeFolders: [],
  fileExtensions: ['md'],
  trackFolderRenames: false,
};

export default class AliasFilenameHistoryPlugin extends Plugin {
  settings: AliasFilenameHistorySettings;
  private debounceMap: Map<string, { queue: Set<string>; timeoutId: NodeJS.Timeout | null; currentPath: string }> = new Map();

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new AliasFilenameHistorySettingTab(this.app, this));
    this.registerEvent(this.app.vault.on('rename', this.handleRename.bind(this)));
  }

  onunload() {
    // Clear any pending timeouts
    for (const entry of this.debounceMap.values()) {
      if (entry.timeoutId !== null) {
        clearTimeout(entry.timeoutId);
      }
    }
    this.debounceMap.clear();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private getBasename(path: string): string {
    const name = path.split('/').pop() || '';
    return name.replace(/\.[^/.]+$/, '');
  }

  private getImmediateParentName(path: string): string {
    const parts = path.split('/');
    parts.pop(); // Remove filename
    return parts.pop() || ''; // Get immediate parent folder name or '' if root
  }

  private async handleRename(newFile: TAbstractFile, oldPath: string) {
    if (!(newFile instanceof TFile)) return;
    if (!this.settings.fileExtensions.includes(newFile.extension)) return;

    const oldBasename = this.getBasename(oldPath);
    const newBasename = newFile.basename;
    const oldImmediateParentName = this.getImmediateParentName(oldPath);
    const newImmediateParentName = this.getImmediateParentName(newFile.path);

    const isNameChange = this.settings.caseSensitive
      ? oldBasename !== newBasename
      : oldBasename.toLowerCase() !== newBasename.toLowerCase();
    const isFolderChange = oldImmediateParentName !== newImmediateParentName && !isNameChange;

    if (!isNameChange && !isFolderChange) {
      console.log(`Skipping rename for "${oldPath}" to "${newFile.path}": no significant change`);
      return;
    }

    const path = newFile.path;
    if (this.settings.includeFolders.length > 0 && !this.settings.includeFolders.some(f => path.startsWith(f + '/') || path === f)) {
      console.log(`Skipping rename for "${path}": not in included folders`);
      return;
    }
    if (this.settings.excludeFolders.some(f => path.startsWith(f + '/') || path === f)) {
      console.log(`Skipping rename for "${path}": in excluded folders`);
      return;
    }

    // Check ignore regexes
    const regexes: RegExp[] = [];
    for (const regexStr of this.settings.ignoreRegexes) {
      try {
        regexes.push(new RegExp(regexStr));
      } catch (e) {
        console.error(`Invalid ignore regex: ${regexStr}`, e);
      }
    }

    let toQueue: string | null = null;
    if (isNameChange) {
      if (regexes.some(re => re.test(oldBasename) || re.test(newBasename))) {
        console.log(`Skipping filename rename from "${oldBasename}" to "${newBasename}" for file "${path}" due to matching ignore regex`);
        return;
      }
      toQueue = oldBasename;
    } else if (isFolderChange && this.settings.trackFolderRenames) {
      if (oldImmediateParentName === '' || newImmediateParentName === '') {
        console.log(`Skipping folder rename for "${path}": root-level file`);
        return;
      }
      if (regexes.some(re => re.test(oldImmediateParentName) || re.test(newImmediateParentName))) {
        console.log(`Skipping folder rename from "${oldImmediateParentName}" to "${newImmediateParentName}" for file "${path}" due to matching ignore regex`);
        return;
      }
      toQueue = oldImmediateParentName;
    }

    if (!toQueue) return;

    let entry: { queue: Set<string>; timeoutId: NodeJS.Timeout | null; currentPath: string };
    if (this.debounceMap.has(oldPath)) {
      entry = this.debounceMap.get(oldPath)!;
      this.debounceMap.delete(oldPath);
      entry.currentPath = newFile.path;
    } else {
      entry = { queue: new Set<string>(), timeoutId: null, currentPath: newFile.path };
    }

    entry.queue.add(toQueue);

    if (entry.timeoutId !== null) {
      clearTimeout(entry.timeoutId);
    }

    entry.timeoutId = setTimeout(() => {
      this.processAliases(entry.currentPath, entry.queue);
      this.debounceMap.delete(entry.currentPath);
    }, this.settings.timeoutSeconds * 1000);

    this.debounceMap.set(newFile.path, entry);
  }

  private async processAliases(path: string, queue: Set<string>) {
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

class AliasFilenameHistorySettingTab extends PluginSettingTab {
  plugin: AliasFilenameHistoryPlugin;

  constructor(app: App, plugin: AliasFilenameHistoryPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Ignore regex patterns')
      .setDesc('Comma-separated regex patterns for filenames or immediate parent folder names to ignore (e.g., ^_ for underscore prefixes, ^Untitled$ for Untitled). Leave empty to disable.')
      .addText((text) =>
        text
          .setPlaceholder('^_,^Untitled$,^Untitled \\d+$')
          .setValue(this.plugin.settings.ignoreRegexes.join(','))
          .onChange(async (value) => {
            this.plugin.settings.ignoreRegexes = value.split(',').map((s) => s.trim()).filter((s) => s);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Timeout seconds')
      .setDesc('Time in seconds the name must be stable before adding aliases.')
      .addSlider((slider) =>
        slider
          .setLimits(1, 20, 1)
          .setValue(this.plugin.settings.timeoutSeconds)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.timeoutSeconds = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Case sensitive uniqueness')
      .setDesc('If enabled, treat "Note" and "note" as different aliases.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.caseSensitive).onChange(async (value) => {
          this.plugin.settings.caseSensitive = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Auto-create properties')
      .setDesc('Automatically create properties with aliases if missing.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoCreateFrontmatter).onChange(async (value) => {
          this.plugin.settings.autoCreateFrontmatter = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Track folder renames')
      .setDesc('If enabled, store old immediate parent folder names as aliases when parent folders are renamed.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.trackFolderRenames).onChange(async (value) => {
          this.plugin.settings.trackFolderRenames = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('File extensions')
      .setDesc('Comma-separated list of file extensions to track, e.g., md,mdx')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.fileExtensions.join(','))
          .onChange(async (value) => {
            this.plugin.settings.fileExtensions = value.split(',').map((s) => s.trim()).filter((s) => s);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Include folders')
      .setDesc('Comma-separated list of folder paths to include (empty for all).')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.includeFolders.join(','))
          .onChange(async (value) => {
            this.plugin.settings.includeFolders = value.split(',').map((s) => s.trim()).filter((s) => s);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Exclude folders')
      .setDesc('Comma-separated list of folder paths to exclude.')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.excludeFolders.join(','))
          .onChange(async (value) => {
            this.plugin.settings.excludeFolders = value.split(',').map((s) => s.trim()).filter((s) => s);
            await this.plugin.saveSettings();
          })
      );
  }
}