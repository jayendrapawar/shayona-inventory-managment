import { redirect } from 'next/navigation'

// Sign-up is handled by Google OAuth — redirect to sign-in
export default function SignUpPage() {
  redirect('/sign-in')
}
