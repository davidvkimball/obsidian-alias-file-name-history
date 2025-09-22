export interface AliasFilenameHistorySettings {
  ignoreRegexes: string[];
  timeoutSeconds: number;
  caseSensitive: boolean;
  autoCreateFrontmatter: boolean;
  includeFolders: string[];
  excludeFolders: string[];
  fileExtensions: string[];
  trackFolderRenames: boolean;
}

export const DEFAULT_SETTINGS: AliasFilenameHistorySettings = {
  ignoreRegexes: ['^_', '^Untitled$', '^Untitled \\d+$'],
  timeoutSeconds: 5,
  caseSensitive: false,
  autoCreateFrontmatter: true,
  includeFolders: [],
  excludeFolders: [],
  fileExtensions: ['md'],
  trackFolderRenames: false,
};
