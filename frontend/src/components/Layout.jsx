import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from './ThemeToggle';
import PasswordChangeModal from './PasswordChangeModal';
import AIChat from './AIChat';

const NAV_ITEMS = [
  {
    section: 'Overview',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: '⊞' },
      { to: '/analytics', label: 'Analytics', icon: '◔' },
      { to: '/forecast', label: 'Capacity Forecast', icon: '📈' },
    ],
  },
  {
    section: 'Inventory',
    items: [
      { to: '/inventory', label: 'Active Inventory', icon: '⬡' },
      { to: '/inventory/deactivated', label: 'Deactivated / Depot', icon: '⚇' },
    ],
  },
];

const PAGE_TITLES = {
  '/dashboard': 'Dashboard',
  '/analytics': 'Analytics',
  '/forecast': 'Capacity Forecast',
  '/inventory': 'Active Inventory',
  '/profile': 'Profile',
};

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const pageTitle =
    PAGE_TITLES[location.pathname] ||
    (location.pathname.startsWith('/inventory/') ? 'Device Detail' : 'InvenTrOps');

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <div className="sidebar__logo">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="2" width="7" height="7" rx="1" fill="#0D1117" opacity="0.8" />
              <rect x="11" y="2" width="7" height="7" rx="1" fill="#0D1117" opacity="0.8" />
              <rect x="2" y="11" width="7" height="7" rx="1" fill="#0D1117" opacity="0.8" />
              <rect x="11" y="11" width="7" height="7" rx="1" fill="#0D1117" opacity="0.6" />
            </svg>
          </div>
          <div>
            <span className="sidebar__app-name">InvenTrOps</span>
            {user?.team_name && (
              <span className="sidebar__team-badge">{user.team_name}</span>
            )}
          </div>
        </div>

        <nav className="sidebar__nav">
          {NAV_ITEMS.map((section) => (
            <div key={section.section}>
              <div className="sidebar__section-label">{section.section}</div>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => {
                    // Special case: /inventory should NOT be active if we are on /inventory/deactivated
                    let effectivelyActive = isActive;
                    if (item.to === '/inventory' && location.pathname === '/inventory/deactivated') {
                      effectivelyActive = false;
                    }
                    return `sidebar__link ${effectivelyActive ? 'sidebar__link--active' : ''}`;
                  }}
                >
                  <span className="sidebar__link-icon">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="sidebar__user">
            <div className="sidebar__avatar">
              {user?.username?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="sidebar__user-info">
              <span className="sidebar__username">{user?.username}</span>
              <span className="sidebar__role">{user?.role}</span>
            </div>
            <button className="sidebar__logout" onClick={logout}>
              Exit
            </button>
          </div>
        </div>
      </aside>

      <div className="main-content">
        <header className="topbar">
          <h1 className="topbar__title">{pageTitle}</h1>
          <div className="topbar__actions">
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              color: 'var(--teal)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: 'var(--teal)',
                boxShadow: '0 0 8px var(--teal-glow)',
                display: 'inline-block',
              }} />
              System OK
            </span>
            <ThemeToggle />
          </div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
        <AIChat />
      </div>
      <PasswordChangeModal />
    </div>
  );
}
