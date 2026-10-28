import type { Api, AppEvents } from '../shared/api'

declare global {
  interface Window {
    api: Api
    events: AppEvents
  }
}

export {}
