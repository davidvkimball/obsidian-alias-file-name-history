import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { AliasFilenameHistorySettings } from '../settings';

interface AliasFilenameHistoryPlugin extends Plugin {
  settings: AliasFilenameHistorySettings;
  saveSettings(): Promise<void>;
}

export class AliasFilenameHistorySettingTab extends PluginSettingTab {
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
      .setDesc('Comma-separated list of folder paths to include (empty for all). Use {vault} or {root} to include only files directly in the vault root (no subfolders).')
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
      .setDesc('Comma-separated list of folder paths to exclude. Use {vault} or {root} to exclude files directly in the vault root (no subfolders).')
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
