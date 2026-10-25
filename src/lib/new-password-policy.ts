/** Policy for newly chosen passwords, separate from existing-password KDFs.
 * Unicode code points count toward the minimum; the existing UTF-16 ceiling
 * bounds request/KDF resources. Never trim or normalize the selected secret.
 */
export function isValidNewPasswordLength(password: unknown): password is string {
  if (typeof password !== "string" || password.length > 4096) return false;
  let codePoints = 0;
  for (const _character of password) {
    codePoints++;
    if (codePoints >= 12) return true;
  }
  return false;
}
