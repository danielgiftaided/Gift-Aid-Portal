export interface AdminLoginIntent {
  adminLogin?: boolean
  adminReturnTo?: string
}
export interface PortalProfile {
  role: string
  charityId?: string | null
  charityName?: string | null
}
export class AccountVerificationError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'AccountVerificationError'
  }
}
export function adminDestination(value?: string): string {
  if (!value || typeof value !== 'string') return '/admin'
  const path = value.split(/[?#]/)[0]
  return (path === '/admin' || path.startsWith('/admin/')) &&
    path !== '/admin/login'
    ? value
    : '/admin'
}
export async function verifyPortalProfile(
  token: string,
  request: typeof fetch = fetch,
): Promise<PortalProfile> {
  const response = await request('/api/user/me', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  let profile
  try {
    profile = await response.json()
  } catch {
    throw new AccountVerificationError(
      'Could not verify your account. Please try again.',
      response.status,
    )
  }
  if (!response.ok || !profile.ok)
    throw new AccountVerificationError(
      profile.error || 'Could not verify your portal account.',
      response.status,
    )
  return profile
}
export function destinationAfterAuth(
  profile: PortalProfile,
  intent: AdminLoginIntent = {},
): string {
  if (intent.adminLogin && profile.role !== 'operator') {
    throw new Error(
      'This account does not have administrator access. Sign in with your registered operator account.',
    )
  }
  if (profile.role === 'operator') return adminDestination(intent.adminReturnTo)
  return profile.charityId ? '/dashboard' : '/charity-setup'
}
export async function finishSignIn(
  client: any,
  navigate: (to: string, options?: any) => void,
  intent: AdminLoginIntent = {},
) {
  const {
    data: { session },
    error,
  } = await client.auth.getSession()
  if (error) throw error
  if (!session)
    throw new Error('Your session has expired. Please sign in again.')
  const profile = await verifyPortalProfile(session.access_token)
  navigate(destinationAfterAuth(profile, intent), {
    replace: true,
    state: { charityName: profile.charityName },
  })
}
