import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from './ThemeToggle';

const NAV_ITEMS = [
  {
    section: 'System',
    items: [
      { to: '/admin/dashboard', label: 'Overview', icon: '⊞' },
      { to: '/admin/ldap', label: 'LDAP Settings', icon: '⚿' },
    ],
  },
  {
    section: 'Management',
    items: [
      { to: '/admin/users', label: 'Users', icon: '⚇' },
      { to: '/admin/teams', label: 'Teams', icon: '⊡' },
      { to: '/admin/integrations', label: 'Integrations', icon: '☍' },
    ],
  },
  {
    section: 'Infrastructure',
    items: [
      { to: '/admin/vendors', label: 'Vendors & Models', icon: '◈' },
      { to: '/admin/infrastructure', label: 'Datacenters', icon: '⊟' },
    ],
  },
];

const PAGE_TITLES = {
  '/admin/dashboard': 'Admin Dashboard',
  '/admin/users': 'User Management',
  '/admin/teams': 'Team Management',
  '/admin/inventory': 'Active Inventory (All Teams)',
  '/admin/vendors': 'Vendors & Hardware Models',
  '/admin/infrastructure': 'Datacenters & Racks',
  '/admin/integrations': 'Third-Party Integrations',
};

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const pageTitle = PAGE_TITLES[location.pathname] || 'Admin Panel';

  return (
    <div className="app-layout">
      <aside className="sidebar" style={{ borderRight: '1px solid rgba(255, 107, 53, 0.15)' }}>
        <div className="sidebar__brand">
          <div className="sidebar__logo" style={{ background: 'var(--orange)' }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="2" width="16" height="16" rx="2" fill="#0D1117" opacity="0.8" />
              <path d="M7 10h6M10 7v6" stroke="#FF6B35" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <span className="sidebar__app-name">InvenTrOps</span>
            <span className="sidebar__team-badge" style={{ color: 'var(--orange)' }}>
              Admin Panel
            </span>
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
                  className={({ isActive }) =>
                    `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`
                  }
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
            <div className="sidebar__avatar" style={{ background: 'var(--orange-dim)', color: 'var(--orange)' }}>
              {user?.username?.[0]?.toUpperCase() || 'A'}
            </div>
            <div className="sidebar__user-info">
              <span className="sidebar__username">{user?.username}</span>
              <span className="sidebar__role">administrator</span>
            </div>
            <button className="sidebar__logout" onClick={logout}>Exit</button>
          </div>
        </div>
      </aside>

      <div className="main-content">
        <header className="topbar">
          <h1 className="topbar__title">{pageTitle}</h1>
          <div className="topbar__actions">
            <span className="badge badge--warning" style={{ fontSize: '0.7rem' }}>ADMIN MODE</span>
            <ThemeToggle />
          </div>
        </header>
        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
