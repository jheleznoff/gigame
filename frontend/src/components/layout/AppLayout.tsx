import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { ToastContainer } from '@/components/ui/toast';

export function AppLayout() {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
      <ToastContainer />
    </div>
  );
}
