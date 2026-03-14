import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

const navItems = [
  { to: "/torrents", label: "Torrents", icon: "M" },
  { to: "/downloads", label: "Downloads", icon: "D" },
  { to: "/history", label: "History", icon: "H" },
  { to: "/settings", label: "Settings", icon: "S" },
];

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-56 bg-rd-dark border-r border-rd-border flex flex-col">
        {/* App title */}
        <div className="p-4 border-b border-rd-border">
          <h1 className="text-lg font-bold text-rd-green">
            DebridDownloader
          </h1>
          {user && (
            <p className="text-xs text-zinc-400 mt-1 truncate">
              {user.username}
            </p>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }: { isActive: boolean }) =>
                `sidebar-link flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm ${
                  isActive ? "active" : "text-zinc-300"
                }`
              }
            >
              <span className="w-5 h-5 flex items-center justify-center rounded bg-rd-border text-xs font-bold">
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* User section */}
        <div className="p-3 border-t border-rd-border">
          <button
            onClick={logout}
            className="w-full px-3 py-2 text-sm text-zinc-400 hover:text-red-400 hover:bg-rd-hover rounded-lg transition-colors"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
