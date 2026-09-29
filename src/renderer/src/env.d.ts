import type { TelegraphApi } from '@shared/types'

declare global {
  interface Window {
    telegraph: TelegraphApi
  }
}
