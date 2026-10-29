import { Alert, Center, Loader } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useWindowAppearance } from './components/AppearanceCard'
import { AppLayout } from './components/AppLayout'
import { MemberDrawerProvider } from './components/MemberDrawer'
import { ReceiptProvider } from './components/ReceiptDialog'
import { api } from './lib/api'
import { CheckIns } from './pages/CheckIns'
import { Credit } from './pages/Credit'
import { Dashboard } from './pages/Dashboard'
import { Duplicates } from './pages/Duplicates'
import { Expired } from './pages/Expired'
import { Expiring } from './pages/Expiring'
import { FirstRun } from './pages/FirstRun'
import { Login } from './pages/Login'
import { Members } from './pages/Members'
import { Payments } from './pages/Payments'
import { PersonalTraining } from './pages/PersonalTraining'
import { Plans } from './pages/Plans'
import { RegistrationWizard } from './pages/RegistrationWizard'
import { Registrations } from './pages/Registrations'
import { Settings } from './pages/Settings'
import { Store } from './pages/Store'

export function App() {
  useWindowAppearance()
  const auth = useQuery({ queryKey: ['auth'], queryFn: () => api.auth.status() })

  if (auth.isPending) {
    return (
      <Center h="100%">
        <Loader />
      </Center>
    )
  }
  if (auth.isError) {
    return (
      <Center h="100%" p="xl">
        <Alert color="red" title="The app couldn’t start">
          {auth.error.message}
        </Alert>
      </Center>
    )
  }
  if (!auth.data.hasPassword) return <FirstRun isEmpty={auth.data.isEmpty} />
  if (!auth.data.authenticated) return <Login />

  return (
    <ReceiptProvider>
      <MemberDrawerProvider>
        <AppLayout>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/check-ins" element={<CheckIns />} />
            <Route path="/members" element={<Members />} />
            <Route path="/members/duplicates" element={<Duplicates />} />
            <Route path="/registrations" element={<Registrations />} />
            <Route path="/registrations/new" element={<RegistrationWizard />} />
            <Route path="/expiring" element={<Expiring />} />
            <Route path="/expired" element={<Expired />} />
            <Route path="/personal-training" element={<PersonalTraining />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/store" element={<Store />} />
            <Route path="/credit" element={<Credit />} />
            <Route path="/plans" element={<Plans />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AppLayout>
      </MemberDrawerProvider>
    </ReceiptProvider>
  )
}
