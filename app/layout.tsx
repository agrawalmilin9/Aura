import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AURA — Your life, understood',
  description: 'AURA is your personal command centre for documents, deadlines, products and everyday life.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/aura-favicon-32.png',
        sizes: '32x32',
        type: 'image/png',
      },
      {
        url: '/aura--mark.png',
        sizes: '256x256',
        type: 'image/png',
      },
    ],
    shortcut: '/aura-favicon-32.png',
    apple: '/aura-apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
