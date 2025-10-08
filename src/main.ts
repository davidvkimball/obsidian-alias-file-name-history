import { Plugin, TAbstractFile, TFile } from 'obsidian';
import { AliasFilenameHistorySettings, DEFAULT_SETTINGS } from './settings';
import { AliasFilenameHistorySettingTab } from './ui/settings-tab';
import { AliasProcessor } from './utils/alias-processor';
import { getBasename, getImmediateParentName } from './utils/path-utils';

export default class AliasFilenameHistoryPlugin extends Plugin {
  settings: AliasFilenameHistorySettings;
  private debounceMap: Map<string, { queue: Set<string>; timeoutId: number; currentPath: string }> = new Map();
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
      if (entry.timeoutId !== 0) {
        window.clearTimeout(entry.timeoutId);
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
      return;
    }

    const path = newFile.path;
    
    // Only apply include/exclude folder checks to file name changes, not folder renames
    if (isNameChange) {
      if (this.settings.includeFolders.length > 0 && !this.settings.includeFolders.some(f => this.isPathInFolder(path, f))) {
        return;
      }
      if (this.settings.excludeFolders.some(f => this.isPathInFolder(path, f))) {
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
        return;
      }
      toQueue = oldBasename;
    } else if (isFolderChange && this.settings.trackFolderRenames && this.settings.trackFolderRenames.trim() !== '') {
      // Check if the current file name matches the specified name (without extension)
      const currentBasename = newFile.basename;
      const matchesFilename = this.settings.caseSensitive 
        ? currentBasename === this.settings.trackFolderRenames
        : currentBasename.toLowerCase() === this.settings.trackFolderRenames.toLowerCase();
      
      if (!matchesFilename) {
        return;
      }
      
      if (oldImmediateParentName === '' || newImmediateParentName === '') {
        return;
      }
      if (regexes.some(re => re.test(oldImmediateParentName) || re.test(newImmediateParentName))) {
        return;
      }
      toQueue = oldImmediateParentName;
    }

    if (!toQueue) return;

    // Check if there's already a pending timeout for this file
    // We need to check both the new path and the old path since the file was just renamed
    let existingEntry = this.debounceMap.get(newFile.path);
    if (!existingEntry) {
      // Check if there's a timeout for the old path (the file was just renamed from there)
      existingEntry = this.debounceMap.get(oldPath);
      if (existingEntry) {
        // Remove the old entry since we're updating it with the new path
        this.debounceMap.delete(oldPath);
      }
    }
    
    if (existingEntry) {
      // File was renamed again before timeout expired - cancel the previous timeout
      if (existingEntry.timeoutId !== 0) {
        window.clearTimeout(existingEntry.timeoutId);
      }
      
      // Use the original stable name from the previous timeout, not the temporary name
      toQueue = Array.from(existingEntry.queue)[0]; // Use the original stable name
    }

    // Create entry to track the timeout
    const entry = { 
      queue: new Set<string>([toQueue]), 
      timeoutId: 0, 
      currentPath: newFile.path 
    };

    // Set timeout to actually store the alias after the debounce period
    entry.timeoutId = window.setTimeout(() => {
      this.aliasProcessor.processAliases(entry.currentPath, entry.queue);
      this.debounceMap.delete(entry.currentPath);
    }, this.settings.timeoutSeconds * 1000);

    this.debounceMap.set(newFile.path, entry);
  }
}
