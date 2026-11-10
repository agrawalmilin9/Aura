'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react'

interface AuthFormCardProps {
  mode: 'login' | 'signup'
}

export function AuthFormCard({ mode }: AuthFormCardProps) {
  const router = useRouter()
  const isSignup = mode === 'signup'

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const trimmedEmail = email.trim()
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Please enter a valid email address.')
      return
    }

    if (isSignup) {
      if (name.trim().length < 2) {
        setError('Please enter your full name (at least 2 characters).')
        return
      }
      if (password.length < 8) {
        setError('Password must be at least 8 characters long.')
        return
      }
      if (password !== confirmPassword) {
        setError('Password and Confirm Password do not match.')
        return
      }
    } else if (!password) {
      setError('Please enter your password.')
      return
    }

    setIsSubmitting(true)
    try {
      const endpoint = isSignup ? '/api/auth/signup' : '/api/auth/login'
      const payload = isSignup
        ? {
            name: name.trim(),
            email: trimmedEmail,
            password,
            confirmPassword,
          }
        : {
            email: trimmedEmail,
            password,
          }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.success) {
        setError(data?.error || (isSignup ? 'Could not create your account.' : 'Invalid email address or password.'))
        return
      }

      router.replace('/')
      router.refresh()
    } catch {
      setError('Network error while connecting to AURA. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f6f5f2',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '440px',
          background: '#ffffff',
          border: '1px solid #e7e4dc',
          borderRadius: '14px',
          padding: '28px 24px',
          boxShadow: '0 14px 36px rgba(38, 38, 36, 0.06)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
          <img
            src="/aura-logo-lockup.png"
            alt="AURA — Your Personal AI Assistant"
            style={{ width: '190px', height: 'auto', display: 'block', objectFit: 'contain' }}
          />
        </div>

        <div style={{ textAlign: 'center', marginBottom: '22px' }}>
          <span className="section-kicker" style={{ display: 'block', marginBottom: '6px' }}>
            {isSignup ? 'CREATE YOUR PRIVATE SPACE' : 'WELCOME BACK'}
          </span>
          <h1 style={{ margin: '0 0 6px', fontSize: '22px', color: '#262624', fontWeight: 700 }}>
            {isSignup ? 'Create your AURA account' : 'Log in to AURA'}
          </h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#78746c', lineHeight: 1.5 }}>
            {isSignup
              ? 'Sign up with your name, email, and a strong password to keep your LifeFile private.'
              : 'Enter your registered email address and password to access your private LifeFile.'}
          </p>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              padding: '10px 12px',
              background: '#fae9e5',
              border: '1px solid #f0d4cc',
              color: '#c96656',
              borderRadius: '8px',
              fontSize: '12px',
              lineHeight: 1.45,
              marginBottom: '16px',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} noValidate>
          {isSignup && (
            <div>
              <label
                htmlFor="auth-name"
                style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#262624', marginBottom: '6px' }}
              >
                Full Name *
              </label>
              <input
                id="auth-name"
                type="text"
                autoComplete="name"
                placeholder="Enter your full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isSubmitting}
                required
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #dedad0',
                  borderRadius: '8px',
                  fontSize: '14px',
                  background: '#fff',
                  color: '#262624',
                }}
              />
            </div>
          )}

          <div>
            <label
              htmlFor="auth-email"
              style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#262624', marginBottom: '6px' }}
            >
              Email Address *
            </label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #dedad0',
                borderRadius: '8px',
                fontSize: '14px',
                background: '#fff',
                color: '#262624',
              }}
            />
          </div>

          <div>
            <label
              htmlFor="auth-password"
              style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#262624', marginBottom: '6px' }}
            >
              Password *
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                placeholder={isSignup ? 'At least 8 characters' : 'Enter your password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting}
                required
                style={{
                  width: '100%',
                  padding: '10px 40px 10px 12px',
                  border: '1px solid #dedad0',
                  borderRadius: '8px',
                  fontSize: '14px',
                  background: '#fff',
                  color: '#262624',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 0,
                  padding: '4px',
                  color: '#78746c',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {isSignup && (
            <div>
              <label
                htmlFor="auth-confirm-password"
                style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#262624', marginBottom: '6px' }}
              >
                Confirm Password *
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="auth-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isSubmitting}
                  required
                  style={{
                    width: '100%',
                    padding: '10px 40px 10px 12px',
                    border: '1px solid #dedad0',
                    borderRadius: '8px',
                    fontSize: '14px',
                    background: '#fff',
                    color: '#262624',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 0,
                    padding: '4px',
                    color: '#78746c',
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          )}

          <button
            type="submit"
            className="primary-button"
            disabled={isSubmitting}
            style={{ width: '100%', justifyContent: 'center', height: '42px', fontSize: '13px', marginTop: '4px' }}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                {isSignup ? 'Creating account...' : 'Logging in...'}
              </>
            ) : (
              <>
                <span>{isSignup ? 'Create Account' : 'Log In'}</span>
                <ArrowRight size={14} />
              </>
            )}
          </button>
        </form>

        <div
          style={{
            marginTop: '20px',
            paddingTop: '16px',
            borderTop: '1px solid #ebe8e1',
            textAlign: 'center',
            fontSize: '12px',
            color: '#6b675f',
          }}
        >
          {isSignup ? (
            <>
              Already have an account?{' '}
              <Link href="/login" style={{ color: '#e47866', fontWeight: 600, textDecoration: 'none' }}>
                Log in
              </Link>
            </>
          ) : (
            <>
              New to AURA?{' '}
              <Link href="/signup" style={{ color: '#e47866', fontWeight: 600, textDecoration: 'none' }}>
                Create an account
              </Link>
            </>
          )}
        </div>

        <div
          style={{
            marginTop: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            fontSize: '11px',
            color: '#8f8b82',
          }}
        >
          <ShieldCheck size={13} style={{ color: '#6d9979' }} />
          <span>Secured with bcrypt password hashing and HTTP-only session cookies.</span>
        </div>
      </div>
    </div>
  )
}
