import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { getGetCurrentUserQueryKey, useGetCurrentUser, useLogout } from '@workspace/api-client-react';
import type { SessionUser } from '@workspace/api-client-react';
import { CalendarDays, ChevronRight, ClipboardList, HeartPulse, LayoutDashboard, LogOut, Menu, Search, Settings, Stethoscope, UserRound, Users, X } from 'lucide-react';

export function Logo({ compact = false }: { compact?: boolean }) {
  return <Link href="/" className="flex items-center gap-3" data-testid="link-logo">
    <span className="grid size-10 place-items-center rounded-[14px] bg-primary text-primary-foreground shadow-sm">
      <HeartPulse size={21} strokeWidth={2.5} />
    </span>
    {!compact && <span className="font-serif text-[1.05rem] font-extrabold tracking-tight text-foreground">care<span className="text-accent">loop</span></span>}
  </Link>;
}

export function Button({ className = '', variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'soft' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-primary text-primary-foreground hover:-translate-y-0.5 hover:shadow-md',
    soft: 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
    ghost: 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
    danger: 'bg-destructive text-destructive-foreground hover:-translate-y-0.5',
  };
  return <button {...props} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`} />;
}

export function Avatar({ name, size = 'md' }: { name?: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials = (name || 'Care team').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  return <span className={`grid shrink-0 place-items-center rounded-full bg-secondary font-mono font-bold text-primary ${size === 'sm' ? 'size-8 text-[10px]' : size === 'lg' ? 'size-16 text-lg' : 'size-10 text-xs'}`} data-testid={`avatar-${name || 'user'}`}>{initials}</span>;
}

export function StatusBadge({ status }: { status?: string }) {
  const style = status === 'Confirmed' || status === 'Active' ? 'bg-[#d8eee8] text-[#17665d]' : status === 'Completed' || status === 'Paused' ? 'bg-[#e4e8ee] text-[#4c5868]' : status === 'Cancelled' ? 'bg-[#f8dfdb] text-[#a53e32]' : 'bg-[#faebc5] text-[#87651b]';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${style}`} data-testid={`status-${status?.toLowerCase()}`}>{status || 'Pending'}</span>;
}

export function LoadingState({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-3" data-testid="loading-state">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-16 rounded-2xl" />)}</div>;
}

export function ErrorState({ message = 'We could not load this view.' }: { message?: string }) {
  return <div className="rounded-2xl border border-destructive/20 bg-[#fff3ef] p-5 text-sm text-destructive" data-testid="error-state"><p className="font-semibold">A small snag</p><p className="mt-1 opacity-80">{message} Try refreshing the page.</p></div>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-border bg-card/60 px-6 py-12 text-center" data-testid="empty-state">
    <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-secondary text-primary"><ClipboardList size={22} /></span>
    <h3 className="mt-4 font-serif text-lg font-bold">{title}</h3><p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{detail}</p>{action && <div className="mt-5">{action}</div>}
  </div>;
}

export function MetricCard({ label, value, detail, accent = false }: { label: string; value: string | number; detail?: string; accent?: boolean }) {
  return <div className={`rounded-2xl border p-5 shadow-sm ${accent ? 'border-primary/20 bg-primary text-primary-foreground' : 'border-card-border bg-card'}`} data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}>
    <p className={`label-caps ${accent ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{label}</p><p className="mt-3 font-serif text-3xl font-extrabold tracking-tight">{value}</p>{detail && <p className={`mt-1 text-xs ${accent ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{detail}</p>}
  </div>;
}

const patientNav = [{ href: '/patient/dashboard', label: 'Overview', icon: LayoutDashboard }, { href: '/patient/doctors', label: 'Find a doctor', icon: Stethoscope }, { href: '/patient/book', label: 'Book appointment', icon: CalendarDays }, { href: '/patient/appointments', label: 'My appointments', icon: ClipboardList }, { href: '/patient/profile', label: 'Profile', icon: UserRound }];
const doctorNav = [{ href: '/doctor/dashboard', label: 'Overview', icon: LayoutDashboard }, { href: '/doctor/appointments', label: 'Schedule', icon: CalendarDays }, { href: '/doctor/profile', label: 'Profile', icon: UserRound }];
const adminNav = [{ href: '/admin/dashboard', label: 'Clinic overview', icon: LayoutDashboard }, { href: '/admin/doctors', label: 'Doctors', icon: Stethoscope }, { href: '/admin/patients', label: 'Patients', icon: Users }, { href: '/admin/appointments', label: 'Appointments', icon: CalendarDays }, { href: '/admin/profile', label: 'Profile', icon: UserRound }];

export function AppShell({ user, children }: { user?: SessionUser | null; children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: sessionUser } = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const logout = useLogout();
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeUser = user || sessionUser;
  const role = activeUser?.role === 'Admin' ? 'admin' : activeUser?.role === 'Doctor' ? 'doctor' : 'patient';
  const nav = role === 'admin' ? adminNav : role === 'doctor' ? doctorNav : patientNav;
  const signOut = () => logout.mutate(undefined, { onSuccess: () => setLocation('/') });
  return <div className="grain min-h-[100dvh] bg-background">
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[250px] -translate-x-full flex-col border-r border-border bg-[#f7f1e5] p-5 transition-transform md:translate-x-0 ${mobileOpen ? 'translate-x-0' : ''}`}>
      <div className="flex items-center justify-between"><Logo /><button className="rounded-lg p-2 text-muted-foreground md:hidden" onClick={() => setMobileOpen(false)} data-testid="button-close-menu"><X size={18} /></button></div>
      <div className="mt-12"><p className="label-caps px-3 text-muted-foreground">Workspace</p><nav className="mt-3 space-y-1">{nav.map(({ href, label, icon: Icon }) => <Link href={href} key={href} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${location === href ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground'}`} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={17} /><span>{label}</span>{location === href && <ChevronRight className="ml-auto" size={15} />}</Link>)}</nav></div>
      <div className="mt-auto rounded-2xl bg-secondary/80 p-4"><p className="label-caps text-primary">Careloop tip</p><p className="mt-2 text-sm leading-5 text-foreground/80">A clear schedule gives your care team room to focus on people.</p></div>
      <div className="mt-4 flex items-center gap-3 border-t border-border pt-4"><Avatar name={activeUser?.name} size="sm" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{activeUser?.name || 'Care team'}</p><p className="truncate text-xs text-muted-foreground">{activeUser?.email || 'Signed in'}</p></div><button onClick={signOut} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" data-testid="button-logout"><LogOut size={17} /></button></div>
    </aside>
     <div className="md:pl-[250px]"><header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-border/70 bg-background/90 px-5 backdrop-blur md:px-10"><div className="flex items-center gap-3"><button className="rounded-xl border border-border p-2 md:hidden" onClick={() => setMobileOpen(true)} data-testid="button-open-menu"><Menu size={19} /></button><div className="md:hidden"><Logo compact /></div></div><div className="flex items-center gap-3"><button className="hidden rounded-xl p-2 text-muted-foreground hover:bg-muted sm:block" data-testid="button-settings"><Settings size={18} /></button><div className="hidden h-5 w-px bg-border sm:block" /><Avatar name={activeUser?.name} size="sm" /></div></header><main className="mx-auto max-w-[1440px] px-5 py-8 md:px-10 md:py-10">{children}</main></div>
  </div>;
}

export function PageHeader({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end animate-rise"><div><p className="label-caps text-primary">{eyebrow}</p><h1 className="mt-2 font-serif text-3xl font-extrabold tracking-tight md:text-4xl">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{detail}</p></div>{action}</div>;
}

export function SearchBox({ value, onChange, placeholder = 'Search by name or email' }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="flex h-11 items-center gap-2 rounded-xl border border-input bg-card px-3 shadow-sm focus-within:border-primary" data-testid="search-field"><Search size={17} className="text-muted-foreground" /><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" data-testid="input-search" /></label>;
}

export function TableRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`grid items-center gap-3 border-b border-border/70 px-4 py-4 last:border-0 md:grid-cols-[1.6fr_1.1fr_1fr_auto] ${className}`}>{children}</div>;
}