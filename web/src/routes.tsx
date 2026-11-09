import type { RouteObject } from 'react-router';
import { RequireAuth, RequirePermission } from './auth/RequireAuth';
import { AppShell } from './layout/AppShell';
import { AboutPage } from './pages/AboutPage';
import { LoginPage } from './pages/LoginPage';
import { MorePage } from './pages/MorePage';
import {
  DocsPage,
  EquipmentPage,
  ForbiddenPage,
  HomePage,
  InventoryPage,
  LabPage,
  NotFoundPage,
  PanelPage,
  ProfilePage,
  ProjectsPage,
  RatingPage,
  ScanPage,
  TasksPage,
} from './pages/sections';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'lab', element: <LabPage /> },
      { path: 'lab/:code', element: <EquipmentPage /> },
      { path: 'scan', element: <ScanPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'inventory', element: <InventoryPage /> },
      { path: 'docs', element: <DocsPage /> },
      { path: 'rating', element: <RatingPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'more', element: <MorePage /> },
      { path: 'about', element: <AboutPage /> },
      {
        path: 'panel',
        element: (
          <RequirePermission action="users.manage" fallback={<ForbiddenPage />}>
            <PanelPage />
          </RequirePermission>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
