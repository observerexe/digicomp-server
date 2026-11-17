import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ApiError } from './api/client';
import { AuthProvider } from './auth/AuthProvider';
import { appNavigated, startAppUpdates } from './lib/appUpdate';
import { routes } from './routes';
import './styles/tokens.css';
import './styles/global.css';
import { applyTheme, storedTheme } from './theme/theme';

applyTheme(storedTheme());
startAppUpdates();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Do not hammer the API with retries on 4xx (permissions, not found).
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

const router = createBrowserRouter(routes);
// A new build waits for the next page: going elsewhere reloads into it (lib/appUpdate.ts).
let path = router.state.location.pathname;
router.subscribe((state) => {
  if (state.location.pathname === path) return;
  path = state.location.pathname;
  appNavigated();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
