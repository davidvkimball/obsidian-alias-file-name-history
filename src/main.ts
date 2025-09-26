import { Plugin, TAbstractFile, TFile } from 'obsidian';
import { AliasFilenameHistorySettings, DEFAULT_SETTINGS } from './settings';
import { AliasFilenameHistorySettingTab } from './ui/settings-tab';
import { AliasProcessor } from './utils/alias-processor';
import { getBasename, getImmediateParentName } from './utils/path-utils';

export default class AliasFilenameHistoryPlugin extends Plugin {
  settings: AliasFilenameHistorySettings;
  private debounceMap: Map<string, { queue: Set<string>; timeoutId: NodeJS.Timeout | null; currentPath: string }> = new Map();
  private aliasProcessor: AliasProcessor;

  async onload() {
    await this.loadSettings();
    this.aliasProcessor = new AliasProcessor(this.app, this.settings);
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

  private isPathInFolder(path: string, folder: string): boolean {
    // Handle vault root variable
    if (folder.includes('{vault}') || folder.includes('{root}')) {
      const resolvedFolder = folder.replace(/\{vault\}|\{root\}/g, '');
      // If the folder is just the variable, it means include only vault root files
      if (resolvedFolder === '' || resolvedFolder === '/') {
        // Include only files directly in the vault root (no subfolders)
        const isVaultRoot = !path.includes('/');
        console.log(`Checking vault root for "${path}": ${isVaultRoot} (vault root only)`);
        return isVaultRoot;
      }
      // Otherwise, replace the variable and check normally
      return path.startsWith(resolvedFolder + '/') || path === resolvedFolder;
    }
    
    // Normal folder matching
    return path.startsWith(folder + '/') || path === folder;
  }

  private async handleRename(newFile: TAbstractFile, oldPath: string) {
    if (!(newFile instanceof TFile)) return;
    if (!this.settings.fileExtensions.includes(newFile.extension)) return;

    const oldBasename = getBasename(oldPath);
    const newBasename = newFile.basename;
    const oldImmediateParentName = getImmediateParentName(oldPath);
    const newImmediateParentName = getImmediateParentName(newFile.path);

    const isNameChange = this.settings.caseSensitive
      ? oldBasename !== newBasename
      : oldBasename.toLowerCase() !== newBasename.toLowerCase();
    const isFolderChange = oldImmediateParentName !== newImmediateParentName && !isNameChange;

    if (!isNameChange && !isFolderChange) {
      console.log(`Skipping rename for "${oldPath}" to "${newFile.path}": no significant change`);
      return;
    }

    const path = newFile.path;
    
    // Only apply include/exclude folder checks to filename changes, not folder renames
    if (isNameChange) {
      if (this.settings.includeFolders.length > 0 && !this.settings.includeFolders.some(f => this.isPathInFolder(path, f))) {
        console.log(`Skipping filename rename for "${path}": not in included folders`);
        return;
      }
      if (this.settings.excludeFolders.some(f => this.isPathInFolder(path, f))) {
        console.log(`Skipping filename rename for "${path}": in excluded folders`);
        return;
      }
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
    const existingEntry = this.debounceMap.get(oldPath);
    if (existingEntry) {
      entry = existingEntry;
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
      this.aliasProcessor.processAliases(entry.currentPath, entry.queue);
      this.debounceMap.delete(entry.currentPath);
    }, this.settings.timeoutSeconds * 1000);

    this.debounceMap.set(newFile.path, entry);
  }
}
