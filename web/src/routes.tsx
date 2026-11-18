import { lazy, Suspense } from 'react';
import { Navigate, type RouteObject } from 'react-router';
import { RequireAuth, RequirePermission, TeamOnly } from './auth/RequireAuth';
import { AppShell } from './layout/AppShell';
import { AboutPage } from './pages/AboutPage';
import { LoginPage } from './pages/LoginPage';
import { MorePage } from './pages/MorePage';
import { DictionariesPage } from './pages/panel/DictionariesPage';
import { DictionaryPage } from './pages/panel/DictionaryPage';
import { FaultsPage } from './pages/panel/FaultsPage';
import { FieldsPage } from './pages/panel/FieldsPage';
import { ManageUserPage } from './pages/panel/ManageUserPage';
import { NewUserPage } from './pages/panel/NewUserPage';
import { OrgPage } from './pages/panel/OrgPage';
import { PanelPage } from './pages/panel/PanelPage';
import { TrashPage } from './pages/panel/TrashPage';
import { AdminPage } from './pages/admin/AdminPage';
import { AuditPage } from './pages/admin/AuditPage';
import { UsersPage } from './pages/panel/UsersPage';
import { DocFormPage } from './pages/docs/DocFormPage';
import { DocPage } from './pages/docs/DocPage';
import { DocsPage } from './pages/docs/DocsPage';
import { PaperLoading } from './pages/editor/PaperLoading';
import { PapersPage } from './pages/editor/PapersPage';
import { VerifyPage } from './pages/editor/VerifyPage';
import { InventoryPage } from './pages/inventory/InventoryPage';
import { ItemFormPage } from './pages/inventory/ItemFormPage';
import { ItemPage } from './pages/inventory/ItemPage';
import { ProjectFormPage } from './pages/projects/ProjectFormPage';
import { ProjectPage } from './pages/projects/ProjectPage';
import { ProjectsPage } from './pages/projects/ProjectsPage';
import { DisciplinePage } from './pages/points/DisciplinePage';
import { PointsPage } from './pages/points/PointsPage';
import { RatingPage } from './pages/points/RatingPage';
import { TaskPage } from './pages/tasks/TaskPage';
import { TasksOverviewPage } from './pages/tasks/TasksOverviewPage';
import { ProjectsOverviewPage } from './pages/projects/ProjectsOverviewPage';
import { TasksPage } from './pages/tasks/TasksPage';
import { BunkerPage } from './pages/fun/bunker/BunkerPage';
import { RoomPage } from './pages/fun/bunker/RoomPage';
import { FunPage } from './pages/fun/FunPage';
import { EquipmentPage } from './pages/lab/EquipmentPage';
import { JournalPage } from './pages/lab/JournalPage';
import { LabPage } from './pages/lab/LabPage';
import { PlaceFormPage } from './pages/lab/PlaceFormPage';
import { ScanPage } from './pages/lab/ScanPage';
import { StickersPage } from './pages/lab/StickersPage';
import { EditProfilePage } from './pages/profile/EditProfilePage';
import { PasswordPage } from './pages/profile/PasswordPage';
import { ProfilePage } from './pages/profile/ProfilePage';
import { TwoFactorPage } from './pages/profile/TwoFactorPage';
import { HomePage } from './pages/home/HomePage';
import { SmartDevicesPage } from './pages/smart/SmartDevicesPage';
import { SmartPage } from './pages/smart/SmartPage';
import { ForbiddenPage, NotFoundPage } from './pages/sections';
import { TeamPage } from './pages/team/TeamPage';
import { UserPage } from './pages/team/UserPage';

// TipTap is loaded only when a document is opened.
const PaperPage = lazy(() => import('./pages/editor/PaperPage').then((m) => ({ default: m.PaperPage })));
const TemplatePage = lazy(() => import('./pages/editor/TemplatePage').then((m) => ({ default: m.TemplatePage })));

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  // A document takes the whole window, like a word processor: no sidebar.
  {
    path: '/editor/templates/:id',
    element: (
      <RequireAuth>
        <RequirePermission action="paper_templates.manage" fallback={<ForbiddenPage />}>
          <Suspense fallback={<PaperLoading />}>
            <TemplatePage />
          </Suspense>
        </RequirePermission>
      </RequireAuth>
    ),
  },
  {
    path: '/editor/:id',
    element: (
      <RequireAuth>
        <TeamOnly fallback={<ForbiddenPage />}>
          <Suspense fallback={<PaperLoading />}>
            <PaperPage />
          </Suspense>
        </TeamOnly>
      </RequireAuth>
    ),
  },
  // A room of «Бункер»: the whole window too.
  {
    path: '/fun/bunker/:id',
    element: (
      <RequireAuth>
        <RequirePermission action="bunker.play" fallback={<ForbiddenPage />}>
          <RoomPage />
        </RequirePermission>
      </RequireAuth>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      // A guest's home is «Розваги».
      { index: true, element: <TeamOnly fallback={<Navigate to="/fun" replace />}><HomePage /></TeamOnly> },
      { path: 'tasks', element: <TeamOnly fallback={<TasksOverviewPage />}><TasksPage /></TeamOnly> },
      { path: 'tasks/:id', element: <TeamOnly fallback={<ForbiddenPage />}><TaskPage /></TeamOnly> },
      { path: 'lab', element: <TeamOnly fallback={<ForbiddenPage />}><LabPage /></TeamOnly> },
      { path: 'lab/journal', element: <TeamOnly fallback={<ForbiddenPage />}><JournalPage /></TeamOnly> },
      {
        path: 'lab/stickers',
        element: (
          <RequirePermission action="places.manage" fallback={<ForbiddenPage />}>
            <StickersPage />
          </RequirePermission>
        ),
      },
      {
        path: 'lab/new',
        element: (
          <RequirePermission action="places.manage" fallback={<ForbiddenPage />}>
            <PlaceFormPage />
          </RequirePermission>
        ),
      },
      {
        path: 'lab/:code/edit',
        element: (
          <RequirePermission action="places.manage" fallback={<ForbiddenPage />}>
            <PlaceFormPage />
          </RequirePermission>
        ),
      },
      { path: 'lab/:code', element: <TeamOnly fallback={<ForbiddenPage />}><EquipmentPage /></TeamOnly> },
      { path: 'scan', element: <TeamOnly fallback={<ForbiddenPage />}><ScanPage /></TeamOnly> },
      { path: 'smart', element: <TeamOnly fallback={<ForbiddenPage />}><SmartPage /></TeamOnly> },
      {
        path: 'smart/devices',
        element: (
          <RequirePermission action="smart.allowlist" fallback={<ForbiddenPage />}>
            <SmartDevicesPage />
          </RequirePermission>
        ),
      },
      { path: 'projects', element: <TeamOnly fallback={<ProjectsOverviewPage />}><ProjectsPage /></TeamOnly> },
      {
        path: 'projects/new',
        element: (
          <RequirePermission action="projects.create" fallback={<ForbiddenPage />}>
            <ProjectFormPage />
          </RequirePermission>
        ),
      },
      { path: 'projects/:id/edit', element: <TeamOnly fallback={<ForbiddenPage />}><ProjectFormPage /></TeamOnly> },
      { path: 'projects/:id', element: <TeamOnly fallback={<ForbiddenPage />}><ProjectPage /></TeamOnly> },
      { path: 'inventory', element: <TeamOnly fallback={<ForbiddenPage />}><InventoryPage /></TeamOnly> },
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
      { path: 'inventory/:code', element: <TeamOnly fallback={<ForbiddenPage />}><ItemPage /></TeamOnly> },
      { path: 'docs', element: <TeamOnly fallback={<ForbiddenPage />}><DocsPage /></TeamOnly> },
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
      { path: 'docs/:id', element: <TeamOnly fallback={<ForbiddenPage />}><DocPage /></TeamOnly> },
      { path: 'editor', element: <TeamOnly fallback={<ForbiddenPage />}><PapersPage /></TeamOnly> },
      // The QR of a printed (frozen) document leads here.
      { path: 'papers/verify/:sha', element: <TeamOnly fallback={<ForbiddenPage />}><VerifyPage /></TeamOnly> },
      { path: 'rating', element: <RatingPage /> },
      {
        path: 'fun',
        element: (
          <RequirePermission action="bunker.play" fallback={<ForbiddenPage />}>
            <FunPage />
          </RequirePermission>
        ),
      },
      {
        path: 'fun/bunker',
        element: (
          <RequirePermission action="bunker.play" fallback={<ForbiddenPage />}>
            <BunkerPage />
          </RequirePermission>
        ),
      },
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
      { path: 'team', element: <TeamOnly fallback={<ForbiddenPage />}><TeamPage /></TeamOnly> },
      { path: 'team/:id', element: <TeamOnly fallback={<ForbiddenPage />}><UserPage /></TeamOnly> },
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
      {
        path: 'panel/users',
        element: (
          <RequirePermission action="users.manage" fallback={<ForbiddenPage />}>
            <UsersPage />
          </RequirePermission>
        ),
      },
      {
        path: 'panel/users/new',
        element: (
          <RequirePermission action="users.create" fallback={<ForbiddenPage />}>
            <NewUserPage />
          </RequirePermission>
        ),
      },
      {
        path: 'panel/users/:id',
        element: (
          <RequirePermission action="users.manage" fallback={<ForbiddenPage />}>
            <ManageUserPage />
          </RequirePermission>
        ),
      },
      {
        path: 'panel/faults',
        element: (
          <RequirePermission action="faults.close" fallback={<ForbiddenPage />}>
            <FaultsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'panel/dictionaries',
        element: (
          <RequirePermission action="dictionaries.manage" fallback={<ForbiddenPage />}>
            <DictionariesPage />
          </RequirePermission>
        ),
      },
      {
        path: 'panel/dictionaries/:key',
        element: (
          <RequirePermission action="dictionaries.manage" fallback={<ForbiddenPage />}>
            <DictionaryPage />
          </RequirePermission>
        ),
      },
      {
        path: 'panel/fields/:type',
        element: (
          <RequirePermission action="records.fields_manage" fallback={<ForbiddenPage />}>
            <FieldsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'panel/trash',
        element: (
          <RequirePermission action="trash.manage" fallback={<ForbiddenPage />}>
            <TrashPage />
          </RequirePermission>
        ),
      },
      {
        path: 'panel/org',
        element: (
          <RequirePermission action="org.manage" fallback={<ForbiddenPage />}>
            <OrgPage />
          </RequirePermission>
        ),
      },
      {
        path: 'admin',
        element: (
          <RequirePermission action="admin.panel" fallback={<ForbiddenPage />}>
            <AdminPage />
          </RequirePermission>
        ),
      },
      {
        path: 'admin/audit',
        element: (
          <RequirePermission action="audit.read" fallback={<ForbiddenPage />}>
            <AuditPage />
          </RequirePermission>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
