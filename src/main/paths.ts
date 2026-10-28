import { app } from 'electron'
import { join } from 'node:path'

export const paths = {
  get db(): string {
    return join(app.getPath('userData'), 'lifestyle.db')
  },
  get backups(): string {
    return join(app.getPath('userData'), 'backups')
  },
  get config(): string {
    return join(app.getPath('userData'), 'config.json')
  },
  get migrations(): string {
    return app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(app.getAppPath(), 'drizzle')
  }
}
