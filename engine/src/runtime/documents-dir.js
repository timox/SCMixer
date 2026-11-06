import { execFileSync } from 'node:child_process';

/**
 * Dossier Documents de l'utilisateur, tel que Windows le connaît (y compris redirigé vers OneDrive ou
 * déplacé) : [Environment]::GetFolderPath('MyDocuments').
 */
export function documentsDir(exec = (file, args) => execFileSync(file, args, { encoding: 'utf8', windowsHide: true })) {
  const out = String(exec('powershell', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('MyDocuments')"])).trim();
  if (out === '') throw new Error('Dossier Documents introuvable : Windows ne renvoie aucun chemin.');
  return out;
}
