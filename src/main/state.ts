import { openDatabase, type Connection } from './db/client'
import { paths } from './paths'
import { createServices, type DomainApi } from './services'

let connection: Connection | null = null
let services: DomainApi | null = null
let authenticated = false

export function openDb(): void {
  connection = openDatabase(paths.db, paths.migrations)
  services = createServices(connection.db)
}

export function closeDb(): void {
  connection?.sqlite.close()
  connection = null
  services = null
}

export function conn(): Connection {
  if (!connection) throw new Error('The database is not open.')
  return connection
}

export function domain(): DomainApi {
  if (!services) throw new Error('The database is not open.')
  return services
}

export const isAuthenticated = (): boolean => authenticated
export const setAuthenticated = (value: boolean): void => {
  authenticated = value
}
