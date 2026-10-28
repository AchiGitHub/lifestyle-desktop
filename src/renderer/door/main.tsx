import '@mantine/core/styles.css'
import './door.css'

import { MantineProvider } from '@mantine/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { theme } from '../theme'
import { DoorApp } from './DoorApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <DoorApp />
    </MantineProvider>
  </StrictMode>
)
