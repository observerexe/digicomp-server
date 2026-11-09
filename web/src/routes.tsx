import type { RouteObject } from 'react-router';
import { RequireAuth, RequirePermission } from './auth/RequireAuth';
import { AppShell } from './layout/AppShell';
import { AboutPage } from './pages/AboutPage';
import { LoginPage } from './pages/LoginPage';
import { MorePage } from './pages/MorePage';
import { DocFormPage } from './pages/docs/DocFormPage';
import { DocPage } from './pages/docs/DocPage';
import { DocsPage } from './pages/docs/DocsPage';
import { InventoryPage } from './pages/inventory/InventoryPage';
import { ItemFormPage } from './pages/inventory/ItemFormPage';
import { ItemPage } from './pages/inventory/ItemPage';
import { ProjectFormPage } from './pages/projects/ProjectFormPage';
import { ProjectPage } from './pages/projects/ProjectPage';
import { ProjectsPage } from './pages/projects/ProjectsPage';
import { DisciplinePage } from './pages/points/DisciplinePage';
import { PointsPage } from './pages/points/PointsPage';
import { RatingPage } from './pages/points/RatingPage';
import { TaskFormPage } from './pages/tasks/TaskFormPage';
import { TaskPage } from './pages/tasks/TaskPage';
import { TasksPage } from './pages/tasks/TasksPage';
import { EquipmentPage } from './pages/lab/EquipmentPage';
import { JournalPage } from './pages/lab/JournalPage';
import { LabPage } from './pages/lab/LabPage';
import { ScanPage } from './pages/lab/ScanPage';
import { StickersPage } from './pages/lab/StickersPage';
import { EditProfilePage } from './pages/profile/EditProfilePage';
import { PasswordPage } from './pages/profile/PasswordPage';
import { ProfilePage } from './pages/profile/ProfilePage';
import { TwoFactorPage } from './pages/profile/TwoFactorPage';
import {
  ForbiddenPage,
  HomePage,
  NotFoundPage,
  PanelPage,
} from './pages/sections';
import { TeamPage } from './pages/team/TeamPage';
import { UserPage } from './pages/team/UserPage';

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
      {
        path: 'tasks/new',
        element: (
          <RequirePermission action="tasks.create" fallback={<ForbiddenPage />}>
            <TaskFormPage />
          </RequirePermission>
        ),
      },
      {
        path: 'tasks/:id/edit',
        element: (
          <RequirePermission action="tasks.manage" fallback={<ForbiddenPage />}>
            <TaskFormPage />
          </RequirePermission>
        ),
      },
      { path: 'tasks/:id', element: <TaskPage /> },
      { path: 'lab', element: <LabPage /> },
      { path: 'lab/journal', element: <JournalPage /> },
      {
        path: 'lab/stickers',
        element: (
          <RequirePermission action="places.manage" fallback={<ForbiddenPage />}>
            <StickersPage />
          </RequirePermission>
        ),
      },
      { path: 'lab/:code', element: <EquipmentPage /> },
      { path: 'scan', element: <ScanPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      {
        path: 'projects/new',
        element: (
          <RequirePermission action="projects.create" fallback={<ForbiddenPage />}>
            <ProjectFormPage />
          </RequirePermission>
        ),
      },
      { path: 'projects/:id/edit', element: <ProjectFormPage /> },
      { path: 'projects/:id', element: <ProjectPage /> },
      { path: 'inventory', element: <InventoryPage /> },
      {
        path: 'inventory/new',
        element: (
          <RequirePermission action="inventory.manage" fallback={<ForbiddenPage />}>
            <ItemFormPage />
          </RequirePermission>
        ),
      },
      {
        path: 'inventory/:code/edit',
        element: (
          <RequirePermission action="inventory.manage" fallback={<ForbiddenPage />}>
            <ItemFormPage />
          </RequirePermission>
        ),
      },
      { path: 'inventory/:code', element: <ItemPage /> },
      { path: 'docs', element: <DocsPage /> },
      {
        path: 'docs/new',
        element: (
          <RequirePermission action="documents.manage" fallback={<ForbiddenPage />}>
            <DocFormPage />
          </RequirePermission>
        ),
      },
      {
        path: 'docs/:id/edit',
        element: (
          <RequirePermission action="documents.manage" fallback={<ForbiddenPage />}>
            <DocFormPage />
          </RequirePermission>
        ),
      },
      { path: 'docs/:id', element: <DocPage /> },
      { path: 'rating', element: <RatingPage /> },
      {
        path: 'points',
        element: (
          <RequirePermission action="points.award" fallback={<ForbiddenPage />}>
            <PointsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'discipline',
        element: (
          <RequirePermission action="discipline.issue" fallback={<ForbiddenPage />}>
            <DisciplinePage />
          </RequirePermission>
        ),
      },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'profile/edit', element: <EditProfilePage /> },
      { path: 'profile/password', element: <PasswordPage /> },
      { path: 'profile/2fa', element: <TwoFactorPage /> },
      { path: 'team', element: <TeamPage /> },
      { path: 'team/:id', element: <UserPage /> },
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
