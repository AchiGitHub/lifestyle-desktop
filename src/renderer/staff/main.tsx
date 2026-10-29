import '@mantine/core/styles.css'
import './staff.css'

import { MantineProvider } from '@mantine/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { theme } from '../theme'
import { StaffApp } from './StaffApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <StaffApp />
    </MantineProvider>
  </StrictMode>
)
