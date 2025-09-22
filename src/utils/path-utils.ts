export function getBasename(path: string): string {
  const name = path.split('/').pop() || '';
  return name.replace(/\.[^/.]+$/, '');
}

export function getImmediateParentName(path: string): string {
  const parts = path.split('/');
  parts.pop(); // Remove filename
  return parts.pop() || ''; // Get immediate parent folder name or '' if root
}
