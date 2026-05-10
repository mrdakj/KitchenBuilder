import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Kitchen Builder',
  description: 'Modular 3D kitchen designer',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
