/// <reference types="vite/client" />
import type { Api } from '@shared/types'
declare global {
  interface Window {
    cm: Api
  }
}
export {}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        partition?: string
        allowpopups?: string
        webpreferences?: string
      }
    }
  }
}
