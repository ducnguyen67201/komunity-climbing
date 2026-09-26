type AuthAction = 'signin' | 'signout'

const apiOrigin = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

async function submitAuthAction(action: AuthAction, provider?: 'google') {
  const response = await fetch(`${apiOrigin}/auth/csrf`, {
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error('Authentication is not configured yet')
  }

  const { csrfToken } = (await response.json()) as { csrfToken: string }
  const form = document.createElement('form')
  form.method = 'post'
  form.action = `${apiOrigin}/auth/${action}${provider ? `/${provider}` : ''}`

  for (const [name, value] of Object.entries({
    csrfToken,
    callbackUrl: window.location.origin,
  })) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  }

  document.body.appendChild(form)
  form.submit()
}

export function signInWithGoogle() {
  return submitAuthAction('signin', 'google')
}

export function signOut() {
  return submitAuthAction('signout')
}
