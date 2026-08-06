'use client'

import { useLanguage } from '@/lib/language-context'
import { Button } from '@/components/ui/button'

export function LanguageToggle() {
  const { language, setLanguage } = useLanguage()

  return (
    <Button
      variant="outline"
      onClick={() => setLanguage(language === 'en' ? 'hi' : 'en')}
      aria-label={language === 'en' ? 'Switch to Hindi' : 'Switch to English'}
    >
      {language === 'en' ? 'हिंदी' : 'English'}
    </Button>
  )
}
