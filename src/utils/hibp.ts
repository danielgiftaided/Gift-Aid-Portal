/**
 * Checks a password against the HaveIBeenPwned database using k-anonymity.
 * Only the first 5 characters of the SHA-1 hash are ever sent to the API —
 * the full password and full hash never leave the browser.
 *
 * Returns true if the password appears in a known data breach.
 * Returns false if the password is clean OR if the API is unreachable
 * (we never block a user due to an API outage).
 */
export async function isPasswordPwned(password: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder()
    const hashBuffer = await crypto.subtle.digest('SHA-1', encoder.encode(password))
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()

    const prefix = hashHex.slice(0, 5)
    const suffix = hashHex.slice(5)

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' }, // prevents traffic analysis
    })
    if (!res.ok) return false

    const lines = (await res.text()).split('\n')
    return lines.some(line => line.split(':')[0].trim() === suffix)
  } catch {
    return false // API unreachable — don't block the user
  }
}

/** Stamps the current time as password_changed_at in Supabase user metadata. */
export async function stampPasswordChanged(supabase: any) {
  await supabase.auth.updateUser({
    data: { password_changed_at: new Date().toISOString() },
  })
}

/** Returns days since password was last changed, or null if never recorded. */
export function daysSincePasswordChange(user: any): number | null {
  const ts = user?.user_metadata?.password_changed_at
  if (!ts) return null
  return (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24)
}

export const PASSWORD_EXPIRY_DAYS = 180
