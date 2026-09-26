import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  AdminAppointmentsPage,
  AdminDashboardPage,
  AdminDoctorsPage,
  AdminPatientsPage,
  DoctorAppointmentsPage,
  DoctorDashboardPage,
  LandingPage,
  PatientAppointmentsPage,
  PatientBookPage,
  PatientDashboardPage,
  PatientDoctorsPage,
  ProfilePage,
  RegisterPage,
} from '@/pages/health-pages';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
          <Route path="/" component={LandingPage} />
          <Route path="/register" component={RegisterPage} />
          <Route path="/patient/dashboard" component={PatientDashboardPage} />
          <Route path="/patient/doctors" component={PatientDoctorsPage} />
          <Route path="/patient/book" component={PatientBookPage} />
          <Route path="/patient/appointments" component={PatientAppointmentsPage} />
          <Route path="/patient/profile" component={() => <ProfilePage role="patient" />} />
          <Route path="/doctor/dashboard" component={DoctorDashboardPage} />
          <Route path="/doctor/appointments" component={DoctorAppointmentsPage} />
          <Route path="/doctor/profile" component={() => <ProfilePage role="doctor" />} />
          <Route path="/admin/dashboard" component={AdminDashboardPage} />
          <Route path="/admin/doctors" component={AdminDoctorsPage} />
          <Route path="/admin/patients" component={AdminPatientsPage} />
          <Route path="/admin/appointments" component={AdminAppointmentsPage} />
          <Route path="/admin/profile" component={() => <ProfilePage role="admin" />} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
