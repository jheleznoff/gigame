import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/chat', label: 'Чат', icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  )},
  { to: '/knowledge-bases', label: 'Базы знаний', icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  )},
  { to: '/scenarios', label: 'Сценарии', icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6"/><path d="m17.66 6.34-4.24 4.24m-2.84 2.84-4.24 4.24"/><path d="M23 12h-6m-6 0H5"/><path d="m17.66 17.66-4.24-4.24m-2.84-2.84L6.34 6.34"/>
    </svg>
  )},
];

export function Sidebar() {
  return (
    <aside className="w-60 border-r border-border bg-card flex flex-col shadow-sm">
      {/* Logo area */}
      <div className="px-5 py-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-[#21a038] flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
          </svg>
        </div>
        <span className="text-lg font-bold tracking-tight text-foreground">GigaMe</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                isActive
                  ? 'bg-[#21a038] text-white font-medium shadow-sm'
                  : 'text-foreground/70 hover:bg-accent hover:text-foreground'
              }`
            }
          >
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-border">
        <div className="text-[10px] text-muted-foreground leading-tight">
          Powered by GigaChat
        </div>
      </div>
    </aside>
  );
}
